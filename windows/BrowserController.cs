using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CineWall;

internal static class BrowserController
{
    private static readonly TimeSpan IdleTime = TimeSpan.FromMinutes(3);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task Run(Action<Uri>? openBrowser = null, CancellationToken cancel = default,
        Func<Pairing, CancellationToken, Task<LanController>>? connect = null)
    {
        connect ??= LanController.Connect;
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [] });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server =>
        {
            server.AddServerHeader = false;
            server.Listen(IPAddress.Loopback, 0);
        });
        await using var app = builder.Build();
        using var idle = new CancellationTokenSource(IdleTime);
        using var idleStop = idle.Token.Register(app.Lifetime.StopApplication);
        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        string origin = "";
        string authority = "";
        int busy = 0;
        app.UseWebSockets();
        app.Run(async context =>
        {
            if (context.Request.Host.Value != authority || !context.Request.Method.Equals("GET", StringComparison.Ordinal))
            {
                context.Response.StatusCode = 403;
                return;
            }
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers["Cross-Origin-Resource-Policy"] = "same-origin";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            context.Response.Headers.ContentSecurityPolicy = $"default-src 'none'; script-src 'self'; style-src 'self'; img-src blob:; connect-src ws://{authority}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
            if (context.Request.Path == "/session")
            {
                if (!context.WebSockets.IsWebSocketRequest || context.Request.Headers.Origin.ToString() != origin)
                {
                    context.Response.StatusCode = 403;
                    return;
                }
                using var socket = await context.WebSockets.AcceptWebSocketAsync();
                using var cancel = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, app.Lifetime.ApplicationStopping);
                bool ownsSession = false;
                try
                {
                    var hello = await Receive<BrowserHello>(socket, 2048, TimeSpan.FromSeconds(5), cancel.Token);
                    if (hello.Token?.Length != token.Length || !CryptographicOperations.FixedTimeEquals(
                        Encoding.UTF8.GetBytes(hello.Token), Encoding.UTF8.GetBytes(token))) return;
                    if (Interlocked.CompareExchange(ref busy, 1, 0) != 0)
                    {
                        await Status(socket, "A CineWall browser session is already active.", cancel.Token);
                        return;
                    }
                    ownsSession = true;
                    idle.CancelAfter(Timeout.InfiniteTimeSpan);
                    using var remote = await connect(Pairing.Parse(hello.Code?.Trim() ?? ""), cancel.Token);
                    var decision = remote.Decision;
                    if (!decision.Approved || decision.Monitors is not { Length: > 0 and <= 16 })
                    {
                        await Status(socket, string.IsNullOrWhiteSpace(decision.Reason) ? "No host display found." : decision.Reason, cancel.Token);
                        return;
                    }
                    await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(decision, Json), WebSocketMessageType.Text, true, cancel.Token);
                    while (true)
                    {
                        var request = await Receive<FrameRequest>(socket, 32 * 1024, TimeSpan.FromSeconds(8), cancel.Token);
                        if (request.Monitor < 0 || request.Monitor >= decision.Monitors.Length || request.Events is not { Length: <= 128 })
                            throw new InvalidDataException("Invalid desktop request.");
                        var image = await remote.Frame(request, cancel.Token);
                        using var write = CancellationTokenSource.CreateLinkedTokenSource(cancel.Token);
                        write.CancelAfter(TimeSpan.FromSeconds(5));
                        await socket.SendAsync(image, WebSocketMessageType.Binary, true, write.Token);
                    }
                }
                catch (Exception error) when (ownsSession && error is not WebSocketException &&
                    !cancel.IsCancellationRequested && socket.State == WebSocketState.Open)
                {
                    var reason = error switch
                    {
                        FormatException or JsonException => "Paste a valid CineWall pairing code.",
                        System.Security.Authentication.AuthenticationException => "CineWall could not verify the host. Ask for a fresh code.",
                        OperationCanceledException => "The host or browser stopped responding.",
                        InvalidOperationException => error.Message,
                        _ => "Connection ended. Check the host and the local network."
                    };
                    try { await Status(socket, reason, cancel.Token); } catch (Exception) { }
                }
                catch (Exception error) when (error is OperationCanceledException or WebSocketException or IOException or JsonException) { }
                finally
                {
                    if (ownsSession)
                    {
                        idle.CancelAfter(IdleTime);
                        Interlocked.Exchange(ref busy, 0);
                    }
                    if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    {
                        using var closing = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                        try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", closing.Token); }
                        catch (Exception error) when (error is WebSocketException or OperationCanceledException) { }
                    }
                }
                return;
            }

            (string resource, string type) = context.Request.Path.Value switch
            {
                "/" => ("web.index", "text/html; charset=utf-8"),
                "/controller.js" => ("web.controller", "text/javascript; charset=utf-8"),
                "/controller.css" => ("web.styles", "text/css; charset=utf-8"),
                _ => ("", "")
            };
            if (resource.Length == 0) { context.Response.StatusCode = 404; return; }
            using var asset = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)!;
            context.Response.ContentType = type;
            context.Response.ContentLength = asset.Length;
            await asset.CopyToAsync(context.Response.Body, context.RequestAborted);
        });
        await app.StartAsync();
        origin = app.Urls.Single();
        authority = new Uri(origin).Authority;
        var page = new Uri(origin + "/#" + token);
        if (openBrowser is null) Process.Start(new ProcessStartInfo(page.AbsoluteUri) { UseShellExecute = true });
        else openBrowser(page);
        await app.WaitForShutdownAsync(cancel);
    }

    private static async Task<T> Receive<T>(WebSocket socket, int limit, TimeSpan duration, CancellationToken cancel)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(duration);
        byte[] buffer = new byte[limit];
        int size = 0;
        do
        {
            if (size == buffer.Length) throw new InvalidDataException();
            var frame = await socket.ReceiveAsync(buffer.AsMemory(size), timeout.Token);
            if (frame.MessageType == WebSocketMessageType.Close) throw new WebSocketException("Browser disconnected.");
            if (frame.MessageType != WebSocketMessageType.Text) throw new InvalidDataException();
            size += frame.Count;
            if (frame.EndOfMessage) break;
        } while (true);
        return JsonSerializer.Deserialize<T>(buffer.AsSpan(0, size), Json) ?? throw new InvalidDataException();
    }

    private static async Task Status(WebSocket socket, string reason, CancellationToken cancel)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(new Decision(false, reason), Json),
            WebSocketMessageType.Text, true, timeout.Token);
    }

    private sealed record BrowserHello(string? Token, string? Code);
}
