using System.Drawing;
using System.Reflection;
using System.Windows.Forms;

namespace CineWall
{
    internal static class LightTheme
    {
        public static readonly Color Page = Color.FromArgb(244, 247, 251);
        public static readonly Color Surface = Color.White;
        public static readonly Color Ink = Color.FromArgb(8, 11, 18);
        public static readonly Color Muted = Color.FromArgb(83, 96, 113);
        public static readonly Color Accent = Color.FromArgb(23, 105, 255);
        public static readonly Color Tint = Color.FromArgb(237, 244, 255);
        public static readonly Color Line = Color.FromArgb(205, 218, 237);
        public static readonly Color Danger = Color.FromArgb(174, 32, 52);

        public static void Apply(Form window)
        {
            window.BackColor = Page;
            window.ForeColor = Ink;
            window.Font = new Font("Segoe UI", 10);
            window.AutoScaleMode = AutoScaleMode.Dpi;
        }

        public static Label Text(string value, int size, bool bold, Color color)
        {
            return new Label { AutoSize = true, Text = value, ForeColor = color,
                Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular) };
        }

        public static void Style(Button button, bool primary = false, bool danger = false)
        {
            button.FlatStyle = FlatStyle.Flat;
            button.BackColor = primary ? Accent : danger ? Color.FromArgb(255, 237, 240) : Surface;
            button.ForeColor = primary ? Color.White : danger ? Danger : Ink;
            button.FlatAppearance.BorderColor = primary ? Accent : Line;
            button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(14, 83, 220) : Tint;
            button.AutoSize = true;
            button.MinimumSize = new Size(0, 38);
            button.Padding = new Padding(11, 5, 11, 5);
            button.Cursor = Cursors.Hand;
        }

        public static FlowLayoutPanel Brand()
        {
            var panel = new FlowLayoutPanel { AutoSize = true, WrapContents = false,
                Padding = new Padding(16, 10, 16, 10), BackColor = Surface };
            var logo = new PictureBox { Size = new Size(46, 36), SizeMode = PictureBoxSizeMode.Zoom,
                Margin = new Padding(0, 0, 8, 0), TabStop = false };
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("CineWallLogo"))
            {
                if (stream != null)
                {
                    using (var image = new Bitmap(stream))
                        logo.Image = new Bitmap(image);
                }
            }
            logo.Disposed += (sender, args) => { if (logo.Image != null) logo.Image.Dispose(); };
            var name = Text("CINEWALL", 14, true, Ink);
            name.Margin = new Padding(0, 5, 0, 0);
            panel.Controls.Add(logo);
            panel.Controls.Add(name);
            return panel;
        }

        public static Panel ScreenGraphic()
        {
            var icon = new Panel { Size = new Size(78, 56), BackColor = Tint, Margin = new Padding(0, 0, 0, 10) };
            icon.Paint += (sender, args) =>
            {
                var g = args.Graphics;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                float scale = icon.Width / 78f;
                g.ScaleTransform(scale, scale);
                using (var stroke = new Pen(Accent, 2.4f))
                {
                    g.DrawRectangle(stroke, 17, 12, 44, 27);
                    g.DrawLine(stroke, 39, 39, 39, 46);
                    g.DrawLine(stroke, 29, 46, 49, 46);
                    g.DrawLine(stroke, 29, 26, 49, 26);
                    g.DrawLine(stroke, 44, 21, 49, 26);
                    g.DrawLine(stroke, 44, 31, 49, 26);
                }
            };
            return icon;
        }
    }
}
