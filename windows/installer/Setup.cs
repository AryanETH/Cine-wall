using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;
using CineWall;

internal static class Setup
{
    private const string Protocol = @"Software\Classes\cinewall-remote";
    private const string Uninstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CineWall";
    private static readonly string Root = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CineWall");
    private static readonly string ProgramMenu = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Programs), "CineWall Remote Control.url");

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            if (args.Length == 1 && args[0] == "--uninstall") Remove();
            else Application.Run(BuildWindow());
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "CineWall Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static Form BuildWindow()
    {
        var window = new Form { Text = "CineWall Setup", ClientSize = new Size(550, 415),
            StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false };
        LightTheme.Apply(window);
        var brand = LightTheme.Brand();
        brand.Dock = DockStyle.Top;
        var card = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown,
            WrapContents = false, Padding = new Padding(22, 16, 22, 14), BackColor = LightTheme.Tint };
        card.Controls.Add(LightTheme.ScreenGraphic());
        card.Controls.Add(LightTheme.Text("Remote Control", 24, true, LightTheme.Ink));
        var description = LightTheme.Text("Connect two Windows PCs over the same Wi-Fi.", 11, false, LightTheme.Muted);
        description.Margin = new Padding(3, 5, 3, 16);
        card.Controls.Add(description);
        var status = LightTheme.Text("Install CineWall for this Windows account.", 10, false, LightTheme.Ink);
        status.MaximumSize = new Size(475, 0);
        card.Controls.Add(status);
        var controls = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(14), BackColor = LightTheme.Surface };
        var install = new Button { Text = "Install CineWall" };
        var close = new Button { Text = "Cancel" };
        LightTheme.Style(install, primary: true);
        LightTheme.Style(close);
        install.Click += (sender, args) =>
        {
            try
            {
                Install();
                status.Text = "Installed. Open Remote Control from CineWall on both PCs.";
                status.ForeColor = Color.FromArgb(8, 122, 69);
                close.Text = "Done";
                install.Enabled = false;
                window.AcceptButton = close;
            }
            catch (Exception error)
            {
                status.ForeColor = LightTheme.Danger;
                status.Text = error.Message;
            }
        };
        close.Click += (sender, args) => window.Close();
        controls.Controls.Add(install);
        controls.Controls.Add(close);
        window.Controls.Add(card);
        window.Controls.Add(controls);
        window.Controls.Add(brand);
        window.AcceptButton = install;
        window.CancelButton = close;
        return window;
    }

    private static void Install()
    {
        RequireAppClosed();
        var programFiles = Environment.GetEnvironmentVariable("ProgramW6432")
            ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var desktopRuntime = Path.Combine(programFiles, "dotnet", "shared", "Microsoft.WindowsDesktop.App");
        if (!Directory.Exists(desktopRuntime) || Directory.GetDirectories(desktopRuntime, "8.0.*").Length == 0)
            throw new InvalidOperationException("Install Microsoft .NET Desktop Runtime 8 (x64), then reopen CineWall Setup.");
        var webRuntime = Path.Combine(programFiles, "dotnet", "shared", "Microsoft.AspNetCore.App");
        if (!Directory.Exists(webRuntime) || Directory.GetDirectories(webRuntime, "8.0.*").Length == 0)
            throw new InvalidOperationException("Install Microsoft ASP.NET Core Runtime 8 (x64), then reopen CineWall Setup.");

        Directory.CreateDirectory(Root);
        using (var contents = Assembly.GetExecutingAssembly().GetManifestResourceStream("CineWallPayload"))
        using (var archive = new ZipArchive(contents, ZipArchiveMode.Read))
        {
            foreach (var entry in archive.Entries)
            {
                if (entry.Name != entry.FullName || entry.Name == "." || entry.Name == "..") throw new InvalidDataException("Invalid installer.");
                entry.ExtractToFile(Path.Combine(Root, entry.Name), true);
            }
        }
        var app = Path.Combine(Root, "CineWall.exe");
        var uninstaller = Path.Combine(Root, "CineWall Setup.exe");
        var source = Assembly.GetExecutingAssembly().Location;
        if (!string.Equals(source, uninstaller, StringComparison.OrdinalIgnoreCase))
            File.Copy(source, uninstaller, true);
        using (var protocol = Registry.CurrentUser.CreateSubKey(Protocol))
        {
            protocol.SetValue("", "URL:CineWall Remote Control");
            protocol.SetValue("URL Protocol", "");
        }
        using (var command = Registry.CurrentUser.CreateSubKey(Protocol + @"\shell\open\command"))
            command.SetValue("", Quote(app) + " \"%1\"");
        using (var settings = Registry.CurrentUser.CreateSubKey(Uninstall))
        {
            settings.SetValue("DisplayName", "CineWall");
            settings.SetValue("DisplayVersion", "1.0.0");
            settings.SetValue("DisplayIcon", app);
            settings.SetValue("Publisher", "CineWall");
            settings.SetValue("UninstallString", Quote(uninstaller) + " --uninstall");
            settings.SetValue("NoModify", 1);
            settings.SetValue("NoRepair", 1);
        }
        File.WriteAllText(ProgramMenu, "[InternetShortcut]\r\nURL=cinewall-remote:share\r\n");
    }

    private static void Remove()
    {
        if (MessageBox.Show("Remove CineWall Remote Control from this Windows account?", "CineWall Setup",
            MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
        RequireAppClosed();
        Registry.CurrentUser.DeleteSubKeyTree(Protocol, false);
        Registry.CurrentUser.DeleteSubKeyTree(Uninstall, false);
        File.Delete(ProgramMenu);
        foreach (var name in new[] { "CineWall.exe", "CineWall.dll", "CineWall.deps.json", "CineWall.runtimeconfig.json" })
            File.Delete(Path.Combine(Root, name));
        MessageBox.Show("CineWall Remote Control was removed.", "CineWall Setup");
    }

    private static void RequireAppClosed()
    {
        if (Process.GetProcessesByName("CineWall").Length > 0)
            throw new InvalidOperationException("Close CineWall Remote Control before proceeding.");
    }

    private static string Quote(string value) { return "\"" + value + "\""; }
}
