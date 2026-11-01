using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// Escritor JSON mínimo, sem dependências (o Revit carrega muitos plugins e
    /// versões diferentes de bibliotecas JSON costumam entrar em conflito).
    /// </summary>
    internal sealed class JsonWriter
    {
        private readonly TextWriter _w;
        private readonly Stack<bool> _first = new Stack<bool>();
        private bool _afterName;

        public JsonWriter(TextWriter w) { _w = w; }

        private void Separator()
        {
            if (_afterName) { _afterName = false; return; }
            if (_first.Count == 0) return;
            if (_first.Peek()) { _first.Pop(); _first.Push(false); }
            else _w.Write(',');
        }

        public JsonWriter BeginObject() { Separator(); _w.Write('{'); _first.Push(true); return this; }
        public JsonWriter EndObject() { _first.Pop(); _w.Write('}'); return this; }
        public JsonWriter BeginArray() { Separator(); _w.Write('['); _first.Push(true); return this; }
        public JsonWriter EndArray() { _first.Pop(); _w.Write(']'); return this; }

        public JsonWriter Name(string name)
        {
            Separator();
            WriteString(name);
            _w.Write(':');
            _afterName = true;
            return this;
        }

        public JsonWriter Value(string s)
        {
            Separator();
            if (s == null) _w.Write("null"); else WriteString(s);
            return this;
        }

        public JsonWriter Value(double v, int decimals = 3)
        {
            Separator();
            if (double.IsNaN(v) || double.IsInfinity(v)) { _w.Write("null"); return this; }
            _w.Write(Math.Round(v, decimals).ToString("0.###", CultureInfo.InvariantCulture));
            return this;
        }

        public JsonWriter Value(int v) { Separator(); _w.Write(v.ToString(CultureInfo.InvariantCulture)); return this; }
        public JsonWriter Value(long v) { Separator(); _w.Write(v.ToString(CultureInfo.InvariantCulture)); return this; }
        public JsonWriter Value(bool v) { Separator(); _w.Write(v ? "true" : "false"); return this; }
        public JsonWriter Null() { Separator(); _w.Write("null"); return this; }

        public JsonWriter Prop(string name, string v) => Name(name).Value(v);
        public JsonWriter Prop(string name, double v, int decimals = 3) => Name(name).Value(v, decimals);
        public JsonWriter Prop(string name, int v) => Name(name).Value(v);
        public JsonWriter Prop(string name, bool v) => Name(name).Value(v);

        /// <summary>Lista de números (coordenadas, índices) sem espaços.</summary>
        public JsonWriter Numbers(string name, IList<double> values, int decimals)
        {
            Name(name);
            Separator();
            _w.Write('[');
            var fmt = decimals <= 0 ? "0" : "0." + new string('#', decimals);
            for (int i = 0; i < values.Count; i++)
            {
                if (i > 0) _w.Write(',');
                _w.Write(Math.Round(values[i], decimals).ToString(fmt, CultureInfo.InvariantCulture));
            }
            _w.Write(']');
            return this;
        }

        public JsonWriter Integers(string name, IList<int> values)
        {
            Name(name);
            Separator();
            _w.Write('[');
            for (int i = 0; i < values.Count; i++)
            {
                if (i > 0) _w.Write(',');
                _w.Write(values[i].ToString(CultureInfo.InvariantCulture));
            }
            _w.Write(']');
            return this;
        }

        private void WriteString(string s)
        {
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            _w.Write(sb.ToString());
        }
    }
}
