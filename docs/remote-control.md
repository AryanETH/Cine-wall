# CineWall Remote Control

Use **Download for Windows** on CineWall’s Remote Control page and run the unsigned x64 installer on both PCs. The installer bundles CineWall’s .NET Desktop and ASP.NET Core components. Maintainers can rebuild the download with `./windows/build-installer.ps1`. Keep both computers on the same private IPv4 subnet. Pairing will fail on guest Wi-Fi that isolates clients. If Windows Firewall asks about CineWall on the host, allow it on your private home network.

1. Open **Remote Control** from the CineWall tools. **Share This Computer** opens the CineWall Windows window. **Control Another Computer** opens a CineWall tab in the browser.
2. On the Infinix, select its Wi-Fi adapter and **Share This Computer**. Copy the two-minute pairing code and pass it privately to the Acer.
3. On the Acer, choose **Control Another Computer**, paste the code, and connect. Check the Acer's Windows computer name and address on the Infinix and approve there.
4. Focus the streamed desktop to send mouse and keyboard input. Select a monitor from the toolbar and use **Fullscreen** to expand the viewer. Use **Stop** on either computer to end the session. In the browser, Tab and Escape are local controls. Windows and the browser also reserve some system shortcuts.

The host uses a temporary TLS certificate and a random pairing secret. The code contains both the certificate fingerprint and the secret. Treat it like a password. On the controller, the browser connects to the installed app over the loopback interface. CineWall exchanges desktop frames and input directly between the selected computers without an internet relay. Reopen the tool from CineWall after closing or reloading the controller tab.

| Capability | Current build |
| --- | --- |
| Signed-in desktop | Attended desktop sharing and input. Windows reserves some shortcuts for the controller. |
| Lock or sign-in screen | Session ends when the interactive desktop is lost. |
| Administrator prompts | Windows restricts input to the current integrity level and controls the secure desktop. |
| Reconnect after a restart | Start a fresh attended session and generate a new code. |
| Trusted Access | Disabled. This build has no Windows-authenticated remote session integration. Windows Home cannot host Microsoft's Remote Desktop. |

[Microsoft Remote Desktop requirements](https://learn.microsoft.com/windows-server/remote/remote-desktop-services/remotepc/remote-desktop-allow-access) · [Windows input integrity limits](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-sendinput)

Run the pairing protocol check with `dotnet run --project windows/tests/ProtocolSmoke.csproj -c Release`. On two physical devices, test approval and denial, expired codes, clicking and dragging in File Explorer, keyboard shortcuts, scrolling, two monitors at different scaling levels, Stop, and a Wi-Fi disconnect while a key is held. Also verify that Windows lock and UAC end the attended session without sharing a secure screen.
