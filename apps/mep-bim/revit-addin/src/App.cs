using System;
using System.Reflection;
using Autodesk.Revit.UI;

namespace SmartEasyBIM.Revit
{
    /// <summary>Cria a aba SmartEasyBIM na faixa do Revit.</summary>
    public class App : IExternalApplication
    {
        public const string TabName = "SmartEasyBIM";

        public Result OnStartup(UIControlledApplication application)
        {
            try { application.CreateRibbonTab(TabName); }
            catch { /* a aba já existe */ }
            var panel = application.CreateRibbonPanel(TabName, "Biblioteca");
            var assembly = Assembly.GetExecutingAssembly().Location;
            var data = new PushButtonData("SmartEasyBIM.ExportarFamilias", "Exportar\nfamílias", assembly, typeof(ExportCommand).FullName)
            {
                ToolTip = "Exporta famílias para a biblioteca do SmartEasyBIM (geometria 3D, tipos, parâmetros e conectores).",
                LongDescription =
                    "Num projeto: escolha as famílias carregadas a exportar. No editor de famílias: exporta a família aberta.\n" +
                    "Gera um arquivo .sebfam; no SmartEasyBIM, use Arquivo › Importar famílias.",
                LargeImage = Icons.Logo(32),
                Image = Icons.Logo(16),
            };
            panel.AddItem(data);
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application) => Result.Succeeded;
    }
}
