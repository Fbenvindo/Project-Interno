using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// Leitor JSON mínimo (respostas do CDE): objetos viram Dictionary&lt;string, object&gt;, listas
    /// List&lt;object&gt;, números double, além de string, bool e null. Sem dependências externas.
    /// </summary>
    internal static class JsonReader
    {
        public static object Parse(string s)
        {
            int i = 0;
            var v = Value(s, ref i);
            Skip(s, ref i);
            if (i < s.Length) throw new FormatException("JSON com conteúdo extra.");
            return v;
        }

        private static void Skip(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        private static object Value(string s, ref int i)
        {
            Skip(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON incompleto.");
            char c = s[i];
            if (c == '{')
            {
                var o = new Dictionary<string, object>();
                i++;
                Skip(s, ref i);
                if (s[i] == '}') { i++; return o; }
                while (true)
                {
                    Skip(s, ref i);
                    var k = Str(s, ref i);
                    Skip(s, ref i);
                    if (s[i++] != ':') throw new FormatException("Esperado ':'.");
                    o[k] = Value(s, ref i);
                    Skip(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == '}') { i++; return o; }
                    throw new FormatException("Esperado ',' ou '}'.");
                }
            }
            if (c == '[')
            {
                var l = new List<object>();
                i++;
                Skip(s, ref i);
                if (s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Value(s, ref i));
                    Skip(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i] == ']') { i++; return l; }
                    throw new FormatException("Esperado ',' ou ']'.");
                }
            }
            if (c == '"') return Str(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (start == i) throw new FormatException($"Caractere inesperado '{c}'.");
            return double.Parse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        private static string Str(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("Esperado texto.");
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u': sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                    default: sb.Append(e); break;
                }
            }
            throw new FormatException("Texto sem fim.");
        }
    }

    /// <summary>Acesso confortável a um objeto JSON lido.</summary>
    internal sealed class JObj
    {
        private readonly Dictionary<string, object> _d;
        public JObj(object o) { _d = o as Dictionary<string, object> ?? new Dictionary<string, object>(); }
        public object this[string k] => _d.TryGetValue(k, out var v) ? v : null;
        public string Str(string k) => this[k] is string s ? s : this[k] is double d ? d.ToString(CultureInfo.InvariantCulture) : null;
        public double Num(string k, double def = 0) => this[k] is double d ? d : def;
        public long Long(string k) => (long)Num(k);
        public bool Bool(string k) => this[k] is bool b && b;
        public JObj Obj(string k) => new JObj(this[k]);
        public List<JObj> Arr(string k) => (this[k] as List<object> ?? new List<object>()).ConvertAll(x => new JObj(x));
        public List<object> Raw(string k) => this[k] as List<object> ?? new List<object>();
        public bool Has(string k) => _d.ContainsKey(k) && _d[k] != null;
    }
}
