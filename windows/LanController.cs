using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;

namespace CineWall;

internal sealed class LanController(TcpClient socket, SslStream secure, Decision decision) : IDisposable
{
    public Decision Decision { get; } = decision;

    public static async Task<LanController> Connect(Pairing ticket, CancellationToken cancel)
    {
        var target = IPAddress.Parse(ticket.Address);
        var adapter = Lan.Available().FirstOrDefault(item => item.Includes(target) && !item.Address.Equals(target))
            ?? throw new InvalidOperationException("Connect both computers to the same Wi-Fi or Ethernet subnet.");
        var socket = new TcpClient(new IPEndPoint(adapter.Address, 0)) { NoDelay = true };
        SslStream? secure = null;
        try
        {
            using var handshake = CancellationTokenSource.CreateLinkedTokenSource(cancel);
            handshake.CancelAfter(TimeSpan.FromSeconds(8));
            await socket.ConnectAsync(target, ticket.Port, handshake.Token);
            secure = ticket.OpenPinnedStream(socket.GetStream());
            await secure.AuthenticateAsClientAsync(new() { TargetHost = "CineWall LAN",
                EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13 }, handshake.Token);
            await Wire.WriteJson(secure, new Hello(ticket.Secret, Environment.MachineName), handshake.Token);
            handshake.CancelAfter(TimeSpan.FromMinutes(2));
            var decision = await Wire.ReadJson<Decision>(secure, 4096, handshake.Token);
            return new LanController(socket, secure, decision);
        }
        catch
        {
            secure?.Dispose();
            socket.Dispose();
            throw;
        }
    }

    public async Task<byte[]> Frame(FrameRequest request, CancellationToken cancel)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        await Wire.WriteJson(secure, request, timeout.Token);
        return await Wire.Read(secure, 4 * 1024 * 1024, timeout.Token);
    }

    public void Dispose()
    {
        secure.Dispose();
        socket.Dispose();
    }
}
