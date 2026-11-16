using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CineWall;

using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
using var certificate = Pairing.CreateCertificate();
using var listener = new TcpListener(IPAddress.Loopback, 0);
listener.Start();
var port = ((IPEndPoint)listener.LocalEndpoint).Port;
var ticket = new Pairing("192.168.1.5", port, RandomNumberGenerator.GetBytes(16), SHA256.HashData(certificate.RawData));
var decoded = Pairing.Parse(ticket.Code);
Check(ticket.Code == decoded.Code, "pairing code round-trip");
Check(!ticket.Authenticates(new Hello(new byte[16], "wrong-key")), "wrong key rejected");
var lan = new Lan(IPAddress.Parse("192.168.1.5"), 24, "Wi-Fi");
Check(lan.Includes(IPAddress.Parse("192.168.1.8")), "same subnet");
Check(!lan.Includes(IPAddress.Parse("192.168.2.8")), "different subnet rejected");
Check(!Lan.IsPrivate(IPAddress.Parse("8.8.8.8")), "public address rejected");

await Task.WhenAll(RunHost(), RunController());
Console.WriteLine("Pairing code, LAN scope, wrong key, pinned TLS, and approval exchange passed.");
await BrowserSmoke();

async Task RunHost()
{
    using var peer = await listener.AcceptTcpClientAsync(timeout.Token);
    using var tls = new SslStream(peer.GetStream());
    await tls.AuthenticateAsServerAsync(new() { ServerCertificate = certificate, EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13 }, timeout.Token);
    var hello = await Wire.ReadJson<Hello>(tls, 1024, timeout.Token);
    Check(ticket.Authenticates(hello), "authenticated controller");
    Check(hello.Name == "Test controller", "device name exchanged");
    await Wire.WriteJson(tls, new Decision(false, "Host declined."), timeout.Token);
}

async Task RunController()
{
    using var peer = new TcpClient();
    await peer.ConnectAsync(IPAddress.Loopback, port, timeout.Token);
    using var tls = decoded.OpenPinnedStream(peer.GetStream());
    await tls.AuthenticateAsClientAsync(new() { TargetHost = "CineWall LAN", EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13 }, timeout.Token);
    await Wire.WriteJson(tls, new Hello(decoded.Secret, "Test controller"), timeout.Token);
    var decision = await Wire.ReadJson<Decision>(tls, 1024, timeout.Token);
    Check(!decision.Approved && decision.Reason == "Host declined.", "explicit host decision");
}

async Task BrowserSmoke()
{
    using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    var opened = new TaskCompletionSource<Uri>(TaskCreationOptions.RunContinuationsAsynchronously);
    var received = new TaskCompletionSource<FrameRequest>(TaskCreationOptions.RunContinuationsAsynchronously);
    byte[] frame = [0xFF, 0xD8, 0xFF, 0xD9];
    var browser = BrowserController.Run(page => opened.TrySetResult(page), stop.Token, async (pair, cancel) =>
    {
        var tcp = new TcpClient();
        await tcp.ConnectAsync(IPAddress.Loopback, port, cancel);
        var tls = pair.OpenPinnedStream(tcp.GetStream());
        await tls.AuthenticateAsClientAsync(new() { TargetHost = "CineWall LAN" }, cancel);
        return new LanController(tcp, tls, new Decision(true, "", ["Monitor 1", "Monitor 2"]));
    });
    var output = RelayFrame();
    try
    {
        Uri page = await opened.Task.WaitAsync(stop.Token);
        string origin = page.GetLeftPart(UriPartial.Authority);
        var endpoint = new Uri("ws://" + page.Authority + "/session");
        using var http = new HttpClient(new HttpClientHandler { UseProxy = false });
        using var index = await http.GetAsync(origin, stop.Token);
        Check(index.IsSuccessStatusCode && (await index.Content.ReadAsStringAsync(stop.Token)).Contains("Pairing code"), "browser page served");
        Check(index.Headers.CacheControl?.NoStore == true && index.Headers.Contains("Content-Security-Policy"), "local page protection");

        using var outside = new ClientWebSocket();
        outside.Options.SetRequestHeader("Origin", "https://example.com");
        try { await outside.ConnectAsync(endpoint, stop.Token); throw new InvalidOperationException("Cross-origin socket accepted."); }
        catch (WebSocketException) { }

        using var untrusted = new ClientWebSocket();
        untrusted.Options.SetRequestHeader("Origin", origin);
        await untrusted.ConnectAsync(endpoint, stop.Token);
        await Send(untrusted, new { token = new string('0', 48), code = ticket.Code });
        var unused = new byte[2048];
        Check((await untrusted.ReceiveAsync(unused.AsMemory(), stop.Token)).MessageType == WebSocketMessageType.Close,
            "wrong local token rejected");

        using var tab = new ClientWebSocket();
        tab.Options.SetRequestHeader("Origin", origin);
        await tab.ConnectAsync(endpoint, stop.Token);
        await Send(tab, new { token = page.Fragment[1..], code = ticket.Code });
        var response = new byte[2048];
        var approval = await tab.ReceiveAsync(response.AsMemory(), stop.Token);
        Check(approval.MessageType == WebSocketMessageType.Text &&
            Encoding.UTF8.GetString(response, 0, approval.Count).Contains("\"approved\":true"), "browser received host approval");
        await Send(tab, new { monitor = 1, events = new[] { new { kind = "down", code = 0, x = 32767, y = 20000 } } });
        var desktop = await tab.ReceiveAsync(response.AsMemory(), stop.Token);
        Check(desktop.MessageType == WebSocketMessageType.Binary && response.AsSpan(0, desktop.Count).SequenceEqual(frame),
            "browser received frame bytes");
        var input = await received.Task.WaitAsync(stop.Token);
        Check(input.Monitor == 1 && input.Events is [{ Kind: "down", X: 32767 }], "browser forwarded monitor and input");
        await tab.CloseAsync(WebSocketCloseStatus.NormalClosure, "", stop.Token);
        await output;
        Console.WriteLine("Local browser page, origin protection, token rejection, approval, monitor input, and frame forwarding passed.");
    }
    finally
    {
        await stop.CancelAsync();
        await browser;
    }

    Task Send(ClientWebSocket peer, object data) =>
        peer.SendAsync(new ArraySegment<byte>(JsonSerializer.SerializeToUtf8Bytes(data)), WebSocketMessageType.Text, true, stop.Token);

    async Task RelayFrame()
    {
        using var peer = await listener.AcceptTcpClientAsync(stop.Token);
        using var tls = new SslStream(peer.GetStream());
        await tls.AuthenticateAsServerAsync(new() { ServerCertificate = certificate }, stop.Token);
        received.SetResult(await Wire.ReadJson<FrameRequest>(tls, 32768, stop.Token));
        await Wire.Write(tls, frame, stop.Token);
    }
}

static void Check(bool condition, string test)
{
    if (!condition) throw new InvalidOperationException(test);
}
