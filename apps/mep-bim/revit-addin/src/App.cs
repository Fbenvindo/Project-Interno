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

            var modelPanel = application.CreateRibbonPanel(TabName, "Modelo");
            var model = new PushButtonData("SmartEasyBIM.ExportarModelo", "Exportar\nmodelo", assembly, typeof(ModelExportCommand).FullName)
            {
                ToolTip = "Exporta o modelo (elementos, famílias, tipos, categorias e parâmetros) para o SmartEasyBIM.",
                LongDescription =
                    "Escolha as categorias (arquitetura e estrutura já vêm marcadas). Vão a geometria, os níveis, os ambientes, os eixos e as coordenadas compartilhadas; " +
                    "plantas, vistas e folhas não. Gera um arquivo .sebmod; no SmartEasyBIM, abra como modelo base ou vincule.",
                LargeImage = Icons.Logo(32),
                Image = Icons.Logo(16),
            };
            modelPanel.AddItem(model);

            var cdePanel = application.CreateRibbonPanel(TabName, "CDE");
            cdePanel.AddItem(new PushButtonData("SmartEasyBIM.PublicarCde", "Publicar\nno CDE", assembly, typeof(PublishCommand).FullName)
            {
                ToolTip = "Exporta o IFC deste modelo e envia como nova revisão do documento no SmartEasyBIM CDE.",
                LongDescription =
                    "Na primeira vez, entre no CDE (endereço do servidor do escritório, e-mail e senha) e escolha o empreendimento e o documento (ou crie um). " +
                    "O IFC sai com as coordenadas compartilhadas e os GUIDs fixos; compartilhado, ele faz as análises de interferências rodarem de novo no CDE.",
                LargeImage = Icons.Logo(32),
                Image = Icons.Logo(16),
            });
            cdePanel.AddItem(new PushButtonData("SmartEasyBIM.Interferencias", "Interfe-\nrências", assembly, typeof(ClashesCommand).FullName)
            {
                ToolTip = "Interferências em aberto deste modelo nas análises do CDE: ver no modelo, comentar e marcar como resolvida.",
                LongDescription =
                    "\"Ver no modelo\" seleciona os elementos (deste modelo e dos vínculos) e abre a vista 3D \"SmartEasyBIM — Interferências\" com caixa de corte em volta. " +
                    "O modelo precisa ter sido publicado pelo \"Publicar no CDE\" (que liga o arquivo ao documento).",
                LargeImage = Icons.Logo(32),
                Image = Icons.Logo(16),
            });
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application) => Result.Succeeded;
    }
}
