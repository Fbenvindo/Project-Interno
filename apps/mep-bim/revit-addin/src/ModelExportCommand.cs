using System;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using TaskDialog = Autodesk.Revit.UI.TaskDialog;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace SmartEasyBIM.Revit
{
    /// <summary>Exporta o modelo aberto para o SmartEasyBIM (arquivo .sebmod).</summary>
    [Transaction(TransactionMode.Manual)]
    public class ModelExportCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument?.Document;
            if (doc == null || doc.IsFamilyDocument)
            {
                TaskDialog.Show("SmartEasyBIM", "Abra um projeto (.rvt) para exportar o modelo.");
                return Result.Cancelled;
            }
            var categories = ModelExporter.Categories(doc);
            if (categories.Count == 0)
            {
                TaskDialog.Show("SmartEasyBIM", "O projeto não tem elementos de modelo para exportar.");
                return Result.Cancelled;
            }
            System.Collections.Generic.HashSet<long> chosen;
            bool instanceParams;
            using (var dlg = new ModelExportDialog(categories))
            {
                if (dlg.ShowDialog() != DialogResult.OK) return Result.Cancelled;
                chosen = dlg.Selected;
                instanceParams = dlg.InstanceParams;
            }
            if (chosen.Count == 0) return Result.Cancelled;

            string path;
            using (var save = new SaveFileDialog
            {
                Title = "Salvar modelo para o SmartEasyBIM",
                Filter = "Modelo SmartEasyBIM (*.sebmod)|*.sebmod",
                FileName = SafeName(Path.GetFileNameWithoutExtension(doc.Title)) + ".sebmod",
            })
            {
                if (save.ShowDialog() != DialogResult.OK) return Result.Cancelled;
                path = save.FileName;
            }

            ModelExportResult r;
            try
            {
                r = ModelExporter.Export(doc, chosen, instanceParams, path, commandData.Application.Application.VersionNumber);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }
            var td = new TaskDialog("SmartEasyBIM")
            {
                MainInstruction = $"Modelo exportado: {r.Elements} elementos",
                MainContent =
                    $"{r.Levels} níveis · {r.Rooms} ambientes · {r.Meshes} geometrias ({r.Shared} instâncias reaproveitaram a geometria do tipo).\n\n" +
                    $"Arquivo: {path}\n\nNo SmartEasyBIM: Arquivo › Novo projeto (modelo base) ou Vincular IFC (referência) e escolha o .sebmod.",
            };
            if (r.Warnings.Count > 0) td.ExpandedContent = string.Join("\n", r.Warnings.Take(30)) + (r.Warnings.Count > 30 ? $"\n… e mais {r.Warnings.Count - 30}" : "");
            td.Show();
            return Result.Succeeded;
        }

        private static string SafeName(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s;
        }
    }
}
