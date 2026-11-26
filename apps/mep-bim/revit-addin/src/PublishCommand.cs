using System;
using System.IO;
using System.Windows.Forms;
using TaskDialog = Autodesk.Revit.UI.TaskDialog;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// Publicar no CDE: exporta o IFC com o exportador do Revit (coordenadas compartilhadas, GUIDs
    /// fixos) e envia como nova revisão do documento no CDE do SmartEasyWEB; opcionalmente compartilha.
    /// No CDE, a análise de interferências que usa este modelo roda de novo sozinha.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    public class PublishCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var uidoc = commandData.Application.ActiveUIDocument;
            var doc = uidoc?.Document;
            if (doc == null || doc.IsFamilyDocument)
            {
                TaskDialog.Show("SmartEasyBIM", "Abra um projeto (.rvt) para publicar no CDE.");
                return Result.Cancelled;
            }
            var cde = CdeClient.Load();
            var key = ProjectKey(doc);
            var view3d = doc.ActiveView as View3D;
            if (view3d != null && view3d.IsTemplate) view3d = null;

            PublishDialog dlg;
            using (dlg = new PublishDialog(cde, cde.LinkOf(key), view3d != null, Path.GetFileNameWithoutExtension(doc.Title)))
            {
                if (dlg.ShowDialog() != DialogResult.OK) return Result.Cancelled;
            }

            string folder = Path.Combine(Path.GetTempPath(), "SmartEasyBIM", "cde-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            try
            {
                // 1) Documento de destino (cria, se for novo).
                var target = dlg.NovoDocumento ? cde.CriarDocumento(dlg.EmpId, dlg.NovoTitulo, dlg.NovaDisciplina, dlg.NovoNivel) : dlg.Documento;

                // 2) IFC: nome = código do documento.
                string name = SafeName(target.Codigo);
                ExportIfc(doc, folder, name, dlg.Ifc4, dlg.OnlyView ? view3d : null);
                string file = Path.Combine(folder, name + ".ifc");
                if (!File.Exists(file)) throw new Exception("O Revit não gerou o arquivo IFC.");

                // 3) Envio e, se escolhido, compartilhamento.
                var desc = string.IsNullOrWhiteSpace(dlg.Descricao) ? $"Publicado do Revit ({doc.Title})" : dlg.Descricao;
                var sent = cde.Enviar(target.Id, file, desc);
                var final = dlg.Share ? cde.MudarEstado(target.Id, "compartilhado", dlg.Finalidade, desc) : sent;

                cde.SetLink(key, new CdeLink
                {
                    Url = cde.Url,
                    EmpId = dlg.EmpId,
                    EmpNome = dlg.EmpNome,
                    DocId = target.Id,
                    DocCodigo = final.Codigo,
                    Ifc4 = dlg.Ifc4,
                    OnlyView = dlg.OnlyView,
                    Share = dlg.Share,
                    Finalidade = dlg.Finalidade,
                });

                var size = new FileInfo(file).Length / 1048576.0;
                new TaskDialog("SmartEasyBIM")
                {
                    MainInstruction = $"{final.Codigo} {final.Revisao} publicado no CDE",
                    MainContent =
                        $"Empreendimento: {dlg.EmpNome}\nArquivo: {name}.ifc ({size:0.0} MB)\nEstado: {(dlg.Share ? $"compartilhado ({dlg.Finalidade})" : "em andamento (só enviado)")}\n\n" +
                        (dlg.Share
                            ? "As análises de interferências que usam este modelo rodam de novo no CDE. Veja o resultado em SmartEasyBIM › Interferências."
                            : "Compartilhe pelo CDE (ou publique de novo marcando \"Compartilhar\") para as análises de interferências usarem esta revisão."),
                }.Show();
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("SmartEasyBIM — Publicar no CDE", ex.Message);
                return Result.Failed;
            }
            finally
            {
                try { Directory.Delete(folder, true); } catch { /* arquivo temporário */ }
            }
        }

        /// <summary>Exporta o IFC numa transação desfeita depois (o exportador mexe no documento).</summary>
        internal static void ExportIfc(Document doc, string folder, string name, bool ifc4, View3D onlyView)
        {
            var opt = new IFCExportOptions
            {
                FileVersion = ifc4 ? IFCVersion.IFC4RV : IFCVersion.IFC2x3CV2,
                WallAndColumnSplitting = false,
                ExportBaseQuantities = false,
            };
            if (onlyView != null) opt.FilterViewId = onlyView.Id;
            // Opções do exportador IFC do Revit (as desconhecidas pela versão instalada são ignoradas).
            opt.AddOption("SitePlacement", "0"); // coordenadas compartilhadas
            opt.AddOption("VisibleElementsOfCurrentView", onlyView != null ? "true" : "false");
            opt.AddOption("ExportRoomsInView", "false");
            opt.AddOption("ExportInternalRevitPropertySets", "false");
            opt.AddOption("ExportIFCCommonPropertySets", "true");
            opt.AddOption("Export2DElements", "false");
            opt.AddOption("ExportLinkedFiles", "false");
            opt.AddOption("IncludeSiteElevation", "true");
            using (var t = new Transaction(doc, "SmartEasyBIM — exportar IFC"))
            {
                t.Start();
                try
                {
                    if (!doc.Export(folder, name + ".ifc", opt)) throw new Exception("O exportador IFC do Revit recusou a exportação.");
                }
                finally
                {
                    t.RollBack();
                }
            }
        }

        /// <summary>Identifica o projeto (o mesmo em todas as cópias locais de um modelo central).</summary>
        internal static string ProjectKey(Document doc) => doc.ProjectInformation?.UniqueId ?? doc.Title;

        private static string SafeName(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s;
        }
    }
}
