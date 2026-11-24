using System;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace SmartEasyBIM.Revit
{
    /// <summary>Ícone do botão (desenhado em código: marinho, cubo claro e nó ciano).</summary>
    internal static class Icons
    {
        public static BitmapSource Logo(int size)
        {
            var px = new byte[size * size * 4];
            void Set(int x, int y, byte r, byte g, byte b, byte a = 255)
            {
                if (x < 0 || y < 0 || x >= size || y >= size) return;
                int i = (y * size + x) * 4;
                px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = a;
            }
            double c = (size - 1) / 2.0;
            double radius = size * 0.12;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    // Fundo marinho com cantos arredondados.
                    double dx = Math.Max(0, Math.Abs(x - c) - (c - radius));
                    double dy = Math.Max(0, Math.Abs(y - c) - (c - radius));
                    if (dx * dx + dy * dy <= radius * radius) Set(x, y, 0x0B, 0x1B, 0x33);
                }
            }
            // Hexágono (cubo) em traço claro.
            var pts = new double[6, 2];
            for (int k = 0; k < 6; k++)
            {
                double a = Math.PI / 6 + k * Math.PI / 3;
                pts[k, 0] = c + Math.Cos(a) * size * 0.36;
                pts[k, 1] = c + Math.Sin(a) * size * 0.36;
            }
            void Line(double x0, double y0, double x1, double y1)
            {
                int n = (int)Math.Ceiling(Math.Max(Math.Abs(x1 - x0), Math.Abs(y1 - y0)) * 2) + 1;
                for (int i = 0; i <= n; i++)
                {
                    double t = (double)i / n;
                    int x = (int)Math.Round(x0 + (x1 - x0) * t), y = (int)Math.Round(y0 + (y1 - y0) * t);
                    Set(x, y, 0xE2, 0xE8, 0xF0);
                    if (size >= 32) Set(x + 1, y, 0xE2, 0xE8, 0xF0);
                }
            }
            for (int k = 0; k < 6; k++) Line(pts[k, 0], pts[k, 1], pts[(k + 1) % 6, 0], pts[(k + 1) % 6, 1]);
            Line(c, c, pts[1, 0], pts[1, 1]);
            Line(c, c, pts[3, 0], pts[3, 1]);
            Line(c, c, pts[5, 0], pts[5, 1]);
            // Nó ciano no centro.
            double nr = size * 0.11;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                    if ((x - c) * (x - c) + (y - c) * (y - c) <= nr * nr) Set(x, y, 0x22, 0xD3, 0xEE);
            var bmp = BitmapSource.Create(size, size, 96, 96, PixelFormats.Bgra32, null, px, size * 4);
            bmp.Freeze();
            return bmp;
        }
    }
}
