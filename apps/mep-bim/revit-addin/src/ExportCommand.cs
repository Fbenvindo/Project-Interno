using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using TaskDialog = Autodesk.Revit.UI.TaskDialog;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace SmartEasyBIM.Revit
{
    /// <summary>Exporta famílias para o SmartEasyBIM (arquivo .sebfam).</summary>
    [Transaction(TransactionMode.Manual)]
    public class ExportCommand : IExternalCommand
    {
        /// <summary>Categorias de famílias de instalações (pré-marcadas na lista).</summary>
        internal static readonly HashSet<string> MepCategories = new HashSet<string>
        {
            "OST_LightingFixtures", "OST_LightingDevices", "OST_ElectricalFixtures", "OST_ElectricalEquipment",
            "OST_DataDevices", "OST_CommunicationDevices", "OST_TelephoneDevices", "OST_SecurityDevices",
            "OST_NurseCallDevices", "OST_FireAlarmDevices", "OST_Sprinklers", "OST_PlumbingFixtures",
            "OST_MechanicalEquipment", "OST_DuctTerminal", "OST_PipeAccessory", "OST_DuctAccessory",
            "OST_ConduitFitting", "OST_CableTrayFitting", "OST_PipeFitting", "OST_DuctFitting",
            "OST_SpecialityEquipment", "OST_FireProtection", "OST_AudioVisualDevices", "OST_PlumbingEquipment",
        };

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uiDoc = commandData.Application.ActiveUIDocument;
            var doc = uiDoc?.Document;
            if (doc == null)
            {
                TaskDialog.Show("SmartEasyBIM", "Abra um projeto com as famílias carregadas, ou uma família (.rfa) no editor de famílias.");
                return Result.Cancelled;
            }
            var revitVersion = commandData.Application.Application.VersionNumber;
            var exported = new List<ExportedFamily>();
            var failures = new List<string>();

            try
            {
                if (doc.IsFamilyDocument)
                {
                    var name = Path.GetFileNameWithoutExtension(doc.Title);
                    exported.Add(FamilyExporter.Export(doc, name));
                }
                else
                {
                    var families = new FilteredElementCollector(doc)
                        .OfClass(typeof(Family))
                        .Cast<Family>()
                        .Where(f => f.IsEditable && f.FamilyCategory != null && f.FamilyCategory.CategoryType == CategoryType.Model)
                        .Select(f =>
                        {
                            var bic = FamilyExporter.BuiltInCategoryName(f.FamilyCategory);
                            return new FamilyEntry
                            {
                                Name = f.Name,
                                Category = f.FamilyCategory.Name,
                                BuiltInCategory = bic,
                                TypeCount = f.GetFamilySymbolIds().Count,
                                IsMep = bic != null && MepCategories.Contains(bic),
                                Tag = f,
                            };
                        })
                        .ToList();
                    if (families.Count == 0)
                    {
                        TaskDialog.Show("SmartEasyBIM", "Nenhuma família editável carregada neste projeto.");
                        return Result.Cancelled;
                    }
                    IList<FamilyEntry> chosen;
                    using (var dlg = new ExportDialog(families))
                    {
                        if (dlg.ShowDialog() != DialogResult.OK) return Result.Cancelled;
                        chosen = dlg.Selected;
                    }
                    if (chosen.Count == 0) return Result.Cancelled;
                    foreach (var entry in chosen)
                    {
                        var family = (Family)entry.Tag;
                        Document famDoc = null;
                        try
                        {
                            famDoc = doc.EditFamily(family);
                            exported.Add(FamilyExporter.Export(famDoc, family.Name));
                        }
                        catch (Exception ex)
                        {
                            failures.Add($"{family.Name}: {ex.Message}");
                        }
                        finally
                        {
                            famDoc?.Close(false);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                message = ex.Message;
                return Result.Failed;
            }

            if (exported.Count == 0)
            {
                TaskDialog.Show("SmartEasyBIM", "Nenhuma família foi exportada.\n\n" + string.Join("\n", failures));
                return Result.Failed;
            }

            string path;
            using (var save = new SaveFileDialog
            {
                Title = "Salvar famílias para o SmartEasyBIM",
                Filter = "Famílias SmartEasyBIM (*.sebfam)|*.sebfam",
                FileName = SafeName(doc.IsFamilyDocument ? exported[0].Name : Path.GetFileNameWithoutExtension(doc.Title) + "-familias") + ".sebfam",
            })
            {
                if (save.ShowDialog() != DialogResult.OK) return Result.Cancelled;
                path = save.FileName;
            }
            PackageWriter.Write(path, exported, revitVersion, doc.Title);

            int types = exported.Sum(f => f.Types.Count);
            var warnings = exported.SelectMany(f => f.Warnings.Select(w => $"{f.Name}: {w}")).ToList();
            var td = new TaskDialog("SmartEasyBIM")
            {
                MainInstruction = $"{exported.Count} família(s) e {types} tipo(s) exportados",
                MainContent = $"Arquivo: {path}\n\nNo SmartEasyBIM, use Arquivo › Importar famílias.",
            };
            var notes = failures.Concat(warnings).Take(20).ToList();
            if (notes.Count > 0) td.ExpandedContent = string.Join("\n", notes);
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
