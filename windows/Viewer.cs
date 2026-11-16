namespace CineWall;

internal sealed class Viewer : Control
{
    private Bitmap? frame;
    private int currentDisplay = -1;
    private readonly List<ControlEvent> events = [];

    public Viewer()
    {
        SetStyle(ControlStyles.Selectable | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = LightTheme.Page;
        TabStop = true;
    }

    public void SetFrame(Bitmap? next, int display)
    {
        frame?.Dispose();
        frame = next;
        currentDisplay = display;
        Invalidate();
    }

    public void ResetInput()
    {
        currentDisplay = -1;
        ReleaseInput();
    }

    private void ReleaseInput()
    {
        Capture = false;
        events.Clear();
        events.Add(new("release"));
    }

    public ControlEvent[] Drain(int display)
    {
        var pending = display == currentDisplay ? events.ToArray() : [new ControlEvent("release")];
        events.Clear();
        return pending;
    }

    private Rectangle ImageArea
    {
        get
        {
            if (frame is null || Width == 0 || Height == 0) return Rectangle.Empty;
            double scale = Math.Min(Width / (double)frame.Width, Height / (double)frame.Height);
            var size = new Size(Math.Max(1, (int)(frame.Width * scale)), Math.Max(1, (int)(frame.Height * scale)));
            return new Rectangle((Width - size.Width) / 2, (Height - size.Height) / 2, size.Width, size.Height);
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (frame is not null && !ImageArea.IsEmpty) e.Graphics.DrawImage(frame, ImageArea);
    }

    private void Queue(ControlEvent item)
    {
        if (currentDisplay < 0) return;
        if (events.Count >= 120) { ReleaseInput(); return; }
        if (item.Kind == "move" && events.Count > 0 && events[^1].Kind == "move") events[^1] = item;
        else events.Add(item);
    }

    private void Pointer(string kind, MouseEventArgs e, int code, bool clamp = false)
    {
        var area = ImageArea;
        if (area.IsEmpty || !clamp && !area.Contains(e.Location)) return;
        int x = (int)Math.Round(Math.Clamp(e.X - area.Left, 0, area.Width - 1) * 65535d / Math.Max(1, area.Width - 1));
        int y = (int)Math.Round(Math.Clamp(e.Y - area.Top, 0, area.Height - 1) * 65535d / Math.Max(1, area.Height - 1));
        Queue(new(kind, code, x, y));
    }

    private static int Button(MouseButtons button) => button switch
    {
        MouseButtons.Left => 0,
        MouseButtons.Right => 1,
        MouseButtons.Middle => 2,
        _ => -1
    };

    protected override void OnMouseMove(MouseEventArgs e) => Pointer("move", e, 0, Capture);
    protected override void OnMouseWheel(MouseEventArgs e) => Pointer("scroll", e, e.Delta);
    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (currentDisplay < 0 || !ImageArea.Contains(e.Location) || Button(e.Button) < 0) return;
        Focus();
        Capture = true;
        Pointer("down", e, Button(e.Button));
    }
    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (Button(e.Button) < 0) return;
        Pointer("up", e, Button(e.Button), Capture);
        if (MouseButtons == MouseButtons.None) Capture = false;
    }
    protected override void OnLostFocus(EventArgs e) { ReleaseInput(); base.OnLostFocus(e); }
    protected override bool IsInputKey(Keys data) => currentDisplay >= 0 && (data & Keys.KeyCode) is not Keys.F11 and not Keys.Escape
        || base.IsInputKey(data);
    protected override void OnKeyDown(KeyEventArgs e) { Queue(new("keyDown", e.KeyValue)); e.Handled = true; }
    protected override void OnKeyUp(KeyEventArgs e) { Queue(new("keyUp", e.KeyValue)); e.Handled = true; }
    protected override void Dispose(bool disposing) { if (disposing) frame?.Dispose(); base.Dispose(disposing); }
}
