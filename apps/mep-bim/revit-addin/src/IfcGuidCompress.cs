using System;

namespace SmartEasyBIM.Revit
{
    internal static partial class IfcGuid
    {
        private const string Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

        /// <summary>GUID → base64 do IFC (22 caracteres, algoritmo da buildingSMART).</summary>
        public static string Compress(Guid guid)
        {
            var b = guid.ToByteArray();
            // Ordem dos bytes como no texto do GUID (big-endian nos três primeiros campos).
            var n = new byte[16]
            {
                b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6],
                b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15],
            };
            var num = new uint[6];
            num[0] = n[0];
            for (int i = 0; i < 5; i++)
                num[i + 1] = (uint)((n[i * 3 + 1] << 16) | (n[i * 3 + 2] << 8) | n[i * 3 + 3]);
            var outp = new char[22];
            int pos = 0;
            for (int i = 0; i < 6; i++)
            {
                int digits = i == 0 ? 2 : 4;
                uint v = num[i];
                for (int k = digits - 1; k >= 0; k--)
                {
                    outp[pos + k] = Chars[(int)(v % 64)];
                    v /= 64;
                }
                pos += digits;
            }
            return new string(outp);
        }
    }
}
