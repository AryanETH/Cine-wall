using System.Net;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32;

namespace CineWall;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.FirstOrDefault() == "cinewall-remote:web")
        {
            try { BrowserController.Run().GetAwaiter().GetResult(); }
            catch (Exception error) { MessageBox.Show(error.Message, "CineWall · Remote Control"); }
            return;
        }
        Application.Run(new RemoteWindow(args.FirstOrDefault()));
    }
}

internal sealed class RemoteWindow : Form
{
    private readonly Label status = new() { AutoSize = true, Text = "Select how to connect.", Margin = new(8, 10, 8, 8) };
    private readonly ComboBox networks = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 236, AccessibleName = "Local network" };
    private readonly TextBox pairing = new() { Width = 236, PlaceholderText = "Paste the pairing code", AccessibleName = "Pairing code" };
    private readonly Button share = new() { Text = "Share This Computer", AutoSize = true };
    private readonly Button connect = new() { Text = "Control Another Computer", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly Button copy = new() { Text = "Copy pairing code", AutoSize = true, Visible = false };
    private readonly ComboBox monitor = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 210, Visible = false };
    private readonly Button full = new() { Text = "Fullscreen (F11)", AutoSize = true, Visible = false };
    private readonly Viewer viewer = new() { Dock = DockStyle.Fill };
    private CancellationTokenSource? session;
    private string? code;
    private bool fullscreen;
    private bool closeAfterSession;

    public RemoteWindow(string? launch)
    {
        Text = "CineWall · Remote Control";
        ClientSize = new(960, 600);
        MinimumSize = new(630, 410);
        LightTheme.Apply(this);
        var brand = LightTheme.Brand();
        brand.Dock = DockStyle.Top;
        var intro = new FlowLayoutPanel { Dock = DockStyle.Top, FlowDirection = FlowDirection.TopDown,
            WrapContents = false, AutoSize = true, Padding = new(16, 14, 16, 8) };
        intro.Controls.Add(LightTheme.ScreenGraphic());
        intro.Controls.Add(LightTheme.Text("Remote Control", 24, true, LightTheme.Ink));
        intro.Controls.Add(LightTheme.Text("Same Wi-Fi · Windows", 10, false, LightTheme.Muted));
        var tools = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new(16, 10, 16, 10),
            BackColor = LightTheme.Surface, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        var info = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1,
            BackColor = LightTheme.Tint, Padding = new(10, 2, 10, 4) };
        status.ForeColor = LightTheme.Accent;
        var edition = Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion", "EditionID", "") as string;
        var capability = edition?.StartsWith("Core", StringComparison.Ordinal) == true
            ? "Windows Home cannot host Microsoft Remote Desktop."
            : "A Windows-authenticated remote session is not integrated in this build.";
        info.Controls.Add(status);
        info.Controls.Add(new Label { AutoSize = true, MaximumSize = new(860, 0), Margin = new(8, 0, 8, 10),
            Text = $"Signed-in desktop: attended only. Trusted Access: off. {capability} Lock, sign-in, administrator prompts and restart reconnect are unavailable." });
        LightTheme.Style(share, primary: true);
        LightTheme.Style(stop, danger: true);
        foreach (Button button in new[] { connect, copy, full }) LightTheme.Style(button);
        foreach (Control field in new Control[] { networks, pairing, monitor })
        {
            field.BackColor = LightTheme.Tint;
            field.ForeColor = LightTheme.Ink;
            field.Margin = new Padding(3, 9, 6, 3);
        }
        pairing.MaxLength = 512;
        pairing.UseSystemPasswordChar = true;
        tools.Controls.Add(ActionRow(networks, share, copy));
        tools.Controls.Add(ActionRow(pairing, connect));
        tools.Controls.Add(ActionRow(stop, monitor, full));
        Controls.Add(viewer);
        Controls.Add(info);
        Controls.Add(tools);
        Controls.Add(intro);
        Controls.Add(brand);
        var adapters = Lan.Available();
        networks.Items.AddRange(adapters);
        networks.SelectedIndex = Array.FindIndex(adapters, adapter =>
            NetworkInterfaceNameLooksWireless(adapter.Name));
        if (networks.SelectedIndex < 0 && adapters.Length > 0) networks.SelectedIndex = 0;
        share.Enabled = networks.Items.Count > 0;
        share.Click += (_, _) => _ = Run(Share);
        connect.Click += (_, _) => _ = Run(Connect);
        stop.Click += (_, _) => session?.Cancel();
        copy.Click += (_, _) => { if (code is not null) Clipboard.SetText(code); };
        full.Click += (_, _) => ToggleFullscreen();
        monitor.SelectedIndexChanged += (_, _) => viewer.ResetInput();
        FormClosing += (_, eventArgs) =>
        {
            if (session is null) return;
            eventArgs.Cancel = true;
            closeAfterSession = true;
            session.Cancel();
        };
        if (launch == "cinewall-remote:control") Shown += (_, _) => pairing.Focus();
        if (launch == "cinewall-remote:share") Shown += (_, _) => share.Focus();
    }

    private static FlowLayoutPanel ActionRow(params Control[] controls)
    {
        var row = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty };
        row.Controls.AddRange(controls);
        return row;
    }

    private static bool NetworkInterfaceNameLooksWireless(string name) =>
        name.Contains("wi-fi", StringComparison.OrdinalIgnoreCase) || name.Contains("wireless", StringComparison.OrdinalIgnoreCase);

    private async Task Run(Func<CancellationToken, Task> mode)
    {
        if (session is not null) return;
        using var cancel = new CancellationTokenSource();
        session = cancel;
        pairing.Enabled = networks.Enabled = share.Enabled = connect.Enabled = false;
        stop.Enabled = true;
        try { await mode(cancel.Token); }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { status.Text = "Session stopped."; }
        catch (OperationCanceledException) { status.Text = "The pairing code expired or the other computer stopped responding."; }
        catch (EndOfStreamException) { status.Text = "The other computer disconnected."; }
        catch (AuthenticationException) { status.Text = "Could not verify the other computer. Ask for a fresh code."; }
        catch (Exception error) when (error is IOException or SocketException or FormatException or JsonException or
            ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            status.Text = error is FormatException or JsonException ? "Enter a valid CineWall pairing code." : error.Message;
        }
        finally
        {
            session = null;
            TopMost = false;
            code = null;
            copy.Visible = monitor.Visible = full.Visible = false;
            viewer.SetFrame(null, -1);
            viewer.ResetInput();
            if (fullscreen) ToggleFullscreen();
            pairing.Enabled = networks.Enabled = connect.Enabled = true;
            share.Enabled = networks.Items.Count > 0;
            stop.Enabled = false;
            if (closeAfterSession) BeginInvoke(Close);
        }
    }

    private async Task Share(CancellationToken cancel)
    {
        if (networks.SelectedItem is not Lan lan || !Desktop.IsInteractive())
            throw new InvalidOperationException("Select your local network and unlock Windows.");
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("Close this elevated window and open CineWall normally to share your desktop.");
        using var certificate = Pairing.CreateCertificate();
        using var listener = new TcpListener(lan.Address, 0);
        listener.Start(4);
        var ticket = new Pairing(lan.Address.ToString(), ((IPEndPoint)listener.LocalEndpoint).Port,
            RandomNumberGenerator.GetBytes(16), SHA256.HashData(certificate.RawData));
        code = ticket.Code;
        copy.Visible = true;
        status.Text = "Pairing code ready · Expires in two minutes";
        using var expiry = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        expiry.CancelAfter(TimeSpan.FromMinutes(2));
        while (!expiry.IsCancellationRequested)
        {
            using var peer = await listener.AcceptTcpClientAsync(expiry.Token);
            if (peer.Client.RemoteEndPoint is not IPEndPoint endpoint || !lan.Includes(endpoint.Address)) continue;
            peer.NoDelay = true;
            using var secure = new System.Net.Security.SslStream(peer.GetStream());
            Hello hello;
            using (var handshake = CancellationTokenSource.CreateLinkedTokenSource(expiry.Token))
            {
                handshake.CancelAfter(TimeSpan.FromSeconds(4));
                try
                {
                    await secure.AuthenticateAsServerAsync(new() { ServerCertificate = certificate,
                        EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13 }, handshake.Token);
                    hello = await Wire.ReadJson<Hello>(secure, 1024, handshake.Token);
                }
                catch (Exception error) when (!expiry.IsCancellationRequested && error is IOException or AuthenticationException
                    or JsonException or OperationCanceledException) { continue; }
            }
            if (!ticket.Authenticates(hello)) continue;
            listener.Stop();
            copy.Visible = false;
            code = null;
            var name = new string((hello.Name ?? "").Where(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or ' ').Take(40).ToArray());
            name = string.IsNullOrWhiteSpace(name) ? "Windows computer" : name;
            using var prompt = new Approval(name, endpoint.Address.ToString());
            using var registration = expiry.Token.Register(() => {
                if (prompt.IsHandleCreated) prompt.BeginInvoke(() => prompt.Close());
            });
            bool approved = prompt.ShowDialog(this) == DialogResult.Yes && !expiry.IsCancellationRequested;
            var displays = Screen.AllScreens;
            await Wire.WriteJson(secure, new Decision(approved, approved ? "" : "The host did not approve the session.",
                approved ? displays.Select(screen => screen.DeviceName).ToArray() : null), cancel);
            if (!approved) { status.Text = "Pairing declined or expired."; return; }
            TopMost = true;
            status.Text = $"Remote control active · {name} · Press Stop to disconnect";
            await HostFrames(secure, displays, cancel);
            return;
        }
        expiry.Token.ThrowIfCancellationRequested();
    }

    private static async Task HostFrames(Stream secure, Screen[] displays, CancellationToken cancel)
    {
        using var input = new Desktop();
        while (true)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            var request = await Wire.ReadJson<FrameRequest>(secure, 32 * 1024, timeout.Token);
            if (request.Monitor < 0 || request.Monitor >= displays.Length || request.Events is null ||
                request.Events.Length > 128) throw new InvalidDataException("Invalid control message.");
            var bounds = displays[request.Monitor].Bounds;
            var image = await Task.Run(() =>
            {
                timeout.Token.ThrowIfCancellationRequested();
                if (!Desktop.IsInteractive() || !Screen.AllScreens.Any(display =>
                    display.DeviceName == displays[request.Monitor].DeviceName && display.Bounds == bounds))
                    throw new IOException("Windows locked, switched desktops or changed the display layout. Start a new session.");
                foreach (var item in request.Events)
                {
                    timeout.Token.ThrowIfCancellationRequested();
                    if (item is not null) input.Apply(item, bounds);
                }
                return Desktop.Capture(bounds);
            }, timeout.Token);
            await Wire.Write(secure, image, timeout.Token);
        }
    }

    private async Task Connect(CancellationToken cancel)
    {
        var ticket = Pairing.Parse(pairing.Text.Trim());
        pairing.Clear();
        status.Text = "Waiting for the host to approve this computer…";
        using var remote = await LanController.Connect(ticket, cancel);
        var decision = remote.Decision;
        if (!decision.Approved) { status.Text = decision.Reason; return; }
        if (decision.Monitors is not { Length: > 0 and <= 16 }) throw new InvalidDataException("No host display found.");
        monitor.Items.Clear();
        for (var i = 0; i < decision.Monitors.Length; i++) monitor.Items.Add($"Monitor {i + 1}");
        monitor.SelectedIndex = 0;
        monitor.Visible = full.Visible = true;
        status.Text = "Remote control active · Click the desktop to send keyboard shortcuts.";
        viewer.Focus();
        while (true)
        {
            int display = monitor.SelectedIndex;
            var bytes = await remote.Frame(new FrameRequest(display, viewer.Drain(display)), cancel);
            if (display == monitor.SelectedIndex)
            {
                using var buffer = new MemoryStream(bytes);
                using var image = Image.FromStream(buffer);
                if (image.Width > 1920 || image.Height > 1080) throw new InvalidDataException("Invalid desktop frame.");
                viewer.SetFrame(new Bitmap(image), display);
            }
            await Task.Delay(80, cancel);
        }
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (full.Visible && (keyData == Keys.F11 || fullscreen && keyData == Keys.Escape))
        {
            ToggleFullscreen();
            return true;
        }
        return base.ProcessCmdKey(ref message, keyData);
    }

    private void ToggleFullscreen()
    {
        fullscreen = !fullscreen;
        FormBorderStyle = fullscreen ? FormBorderStyle.None : FormBorderStyle.Sizable;
        WindowState = fullscreen ? FormWindowState.Maximized : FormWindowState.Normal;
        viewer.Focus();
    }
}

internal sealed class Approval : Form
{
    public Approval(string name, string address)
    {
        Text = "CineWall · Approve remote control";
        LightTheme.Apply(this);
        ClientSize = new(490, 170);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        var approve = new Button { Text = "Approve", DialogResult = DialogResult.Yes, AutoSize = true };
        var deny = new Button { Text = "Deny", DialogResult = DialogResult.No, AutoSize = true };
        LightTheme.Style(approve, primary: true);
        LightTheme.Style(deny);
        CancelButton = deny;
        var actions = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new(12) };
        actions.Controls.AddRange([deny, approve]);
        Controls.Add(new Label { Dock = DockStyle.Fill, Padding = new(14), Text =
            $"{name} ({address}) is asking to see and control your desktop. Approve only if you recognize this computer." });
        Controls.Add(actions);
    }
}
