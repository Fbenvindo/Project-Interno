using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace SmartEasyBIM.Revit
{
    /// <summary>Grava o pacote de famílias (.sebfam) lido pelo SmartEasyBIM.</summary>
    internal static class PackageWriter
    {
        public const string Format = "smarteasybim/familias";
        public const int Version = 1;

        public static void Write(string path, IList<ExportedFamily> families, string revitVersion, string sourceTitle)
        {
            using (var sw = new StreamWriter(path, false, new UTF8Encoding(false)))
            {
                var w = new JsonWriter(sw);
                w.BeginObject()
                    .Prop("formato", Format)
                    .Prop("versao", Version)
                    .Prop("origem", "Revit " + revitVersion)
                    .Prop("arquivo", sourceTitle)
                    .Prop("exportadoEm", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"))
                    .Prop("unidades", "mm");
                w.Name("familias").BeginArray();
                foreach (var f in families) WriteFamily(w, f);
                w.EndArray();
                w.EndObject();
            }
        }

        private static void WriteFamily(JsonWriter w, ExportedFamily f)
        {
            w.BeginObject()
                .Prop("uid", f.Uid)
                .Prop("nome", f.Name)
                .Prop("categoria", f.Category)
                .Prop("categoriaRevit", f.BuiltInCategory)
                .Prop("hospedagem", f.Hosting)
                .Prop("posicionamento", f.Placement);

            w.Name("conectores").BeginArray();
            foreach (var c in f.Connectors)
            {
                w.BeginObject()
                    .Prop("dominio", c.Domain)
                    .Prop("forma", c.Shape)
                    .Prop("sistema", c.System);
                w.Numbers("origem", c.Origin, 1);
                w.Numbers("direcao", c.Direction, 4);
                if (c.Diameter > 0) w.Prop("diametro", c.Diameter, 1);
                if (c.Width > 0) w.Prop("largura", c.Width, 1);
                if (c.Height > 0) w.Prop("altura", c.Height, 1);
                w.EndObject();
            }
            w.EndArray();

            w.Name("tipos").BeginArray();
            foreach (var t in f.Types)
            {
                w.BeginObject().Prop("nome", t.Name);
                w.Name("parametros").BeginArray();
                foreach (var p in t.Params)
                {
                    w.BeginObject().Prop("nome", p.Name);
                    if (p.BuiltIn != null) w.Prop("nativo", p.BuiltIn);
                    w.Prop("instancia", p.IsInstance);
                    w.Name("valor");
                    if (p.Bool.HasValue) w.Value(p.Bool.Value);
                    else if (p.Number.HasValue) w.Value(p.Number.Value, 4);
                    else w.Value(p.Text);
                    if (p.Text != null) w.Prop("texto", p.Text);
                    if (p.Unit != null) w.Prop("unidade", p.Unit);
                    w.EndObject();
                }
                w.EndArray();
                if (t.Indices.Count > 0)
                {
                    w.Name("malha").BeginObject();
                    w.Numbers("posicoes", t.Positions, 1);
                    w.Integers("indices", t.Indices);
                    if (t.Palette.Count > 1 || (t.Palette.Count == 1 && t.Palette[0] != "#a8adb5"))
                    {
                        w.Name("paleta").BeginArray();
                        foreach (var c in t.Palette) w.Value(c);
                        w.EndArray();
                        w.Integers("cores", t.Colors);
                    }
                    w.EndObject();
                    w.Numbers("min", t.Min, 1);
                    w.Numbers("max", t.Max, 1);
                }
                if (t.PlanLines.Count > 0)
                {
                    w.Name("planta").BeginArray();
                    foreach (var l in t.PlanLines) w.Numbers(null, l, 1);
                    w.EndArray();
                }
                w.EndObject();
            }
            w.EndArray();

            w.Name("avisos").BeginArray();
            foreach (var a in f.Warnings) w.Value(a);
            w.EndArray();
            w.EndObject();
        }
    }
}
