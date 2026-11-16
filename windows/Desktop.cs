using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace CineWall;

internal sealed class Desktop : IDisposable
{
    private readonly HashSet<ushort> keys = [];
    private readonly HashSet<int> buttons = [];
    private static readonly (uint Down, uint Up)[] ButtonFlags = [(2, 4), (8, 16), (32, 64)];

    public static bool IsInteractive()
    {
        IntPtr desktop = OpenInputDesktop(0, false, 1);
        if (desktop == IntPtr.Zero) return false;
        try
        {
            var name = new StringBuilder(128);
            return GetUserObjectInformation(desktop, 2, name, 256, out _) &&
                name.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase);
        }
        finally { CloseDesktop(desktop); }
    }

    public static byte[] Capture(Rectangle bounds)
    {
        using var source = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(source))
            graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
        double scale = Math.Min(1d, Math.Min(1920d / bounds.Width, 1080d / bounds.Height));
        using var frame = scale == 1 ? null : new Bitmap(source, new Size(
            Math.Max(1, (int)(bounds.Width * scale)), Math.Max(1, (int)(bounds.Height * scale))));
        using var buffer = new MemoryStream();
        (frame ?? source).Save(buffer, ImageFormat.Jpeg);
        return buffer.ToArray();
    }

    public void Apply(ControlEvent item, Rectangle bounds)
    {
        switch (item.Kind)
        {
            case "release":
                Release();
                break;
            case "keyDown" or "keyUp" when item.Code is >= 8 and <= 254:
                var key = (ushort)item.Code;
                bool down = item.Kind == "keyDown";
                if (down ? Key(key, false) : keys.Contains(key) && Key(key, true))
                {
                    if (down) keys.Add(key);
                    else keys.Remove(key);
                }
                break;
            case "move" or "down" or "up" or "scroll":
                if (item.X is < 0 or > 65535 || item.Y is < 0 or > 65535) return;
                var desktop = SystemInformation.VirtualScreen;
                int x = bounds.Left + (int)Math.Round(item.X / 65535d * (bounds.Width - 1));
                int y = bounds.Top + (int)Math.Round(item.Y / 65535d * (bounds.Height - 1));
                int absoluteX = (int)Math.Round((x - desktop.Left) * 65535d / Math.Max(1, desktop.Width - 1));
                int absoluteY = (int)Math.Round((y - desktop.Top) * 65535d / Math.Max(1, desktop.Height - 1));
                Mouse(0xC001, 0, absoluteX, absoluteY);
                if (item.Kind == "scroll") Mouse(0x800, Math.Clamp(item.Code, -1200, 1200));
                if (item.Code is >= 0 and < 3)
                {
                    if (item.Kind == "down" && !buttons.Contains(item.Code) && Mouse(ButtonFlags[item.Code].Down)) buttons.Add(item.Code);
                    if (item.Kind == "up" && buttons.Contains(item.Code) && Mouse(ButtonFlags[item.Code].Up)) buttons.Remove(item.Code);
                }
                break;
        }
    }

    private void Release()
    {
        foreach (ushort key in keys.ToArray()) if (Key(key, true)) keys.Remove(key);
        foreach (int button in buttons.ToArray()) if (Mouse(ButtonFlags[button].Up)) buttons.Remove(button);
    }

    public void Dispose() => Release();

    private static bool Key(ushort code, bool up)
    {
        uint extended = code is 0x21 or 0x22 or 0x23 or 0x24 or 0x25 or 0x26 or 0x27 or 0x28
            or 0x2D or 0x2E or 0x5B or 0x5C or 0x6F or 0xA3 or 0xA5 ? 1u : 0u;
        return Inject(new Input { Type = 1, Value = new InputValue
            { Key = new KeyboardInput { Vk = code, Flags = extended | (up ? 2u : 0u) } } });
    }

    private static bool Mouse(uint flags, int data = 0, int x = 0, int y = 0) =>
        Inject(new Input { Type = 0, Value = new InputValue
            { Mouse = new MouseInput { X = x, Y = y, Data = data, Flags = flags } } });

    private static bool Inject(Input input) => SendInput(1, [input], Marshal.SizeOf<Input>()) == 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint Type; public InputValue Value; }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputValue { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Key; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput { public int X, Y, Data; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput { public ushort Vk, Scan; public uint Flags, Time; public UIntPtr Extra; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint size, out uint required);
    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr handle);
}
