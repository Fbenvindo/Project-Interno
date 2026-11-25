using System;
using Autodesk.Revit.DB;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// GlobalId do IFC (22 caracteres) de um elemento do Revit, igual ao que o exportador IFC do
    /// Revit grava: o parâmetro "IfcGUID", se preenchido, ou o Export Id do elemento comprimido.
    /// É o que liga uma interferência do CDE de volta ao elemento no modelo.
    /// </summary>
    internal static partial class IfcGuid
    {
        public static string Of(Document doc, Element e)
        {
            try
            {
                var p = e.get_Parameter(BuiltInParameter.IFC_GUID);
                var s = p?.AsString();
                if (!string.IsNullOrEmpty(s) && s.Length == 22) return s;
            }
            catch
            {
                /* elemento sem o parâmetro */
            }
            try
            {
                return Compress(ExportUtils.GetExportId(doc, e.Id));
            }
            catch
            {
                return null;
            }
        }
    }
}
