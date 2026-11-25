using System;
using TaskDialog = Autodesk.Revit.UI.TaskDialog;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace SmartEasyBIM.Revit
{
    /// <summary>Abre a janela de interferências do CDE para o modelo aberto (ligado pelo Publicar no CDE).</summary>
    [Transaction(TransactionMode.Manual)]
    public class ClashesCommand : IExternalCommand
    {
        private static ClashSelector _selector;
        private static ExternalEvent _event;
        private static ClashWindow _window;
        private static string _windowKey;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            var doc = commandData.Application.ActiveUIDocument?.Document;
            if (doc == null || doc.IsFamilyDocument)
            {
                TaskDialog.Show("SmartEasyBIM", "Abra um projeto (.rvt) para ver as interferências.");
                return Result.Cancelled;
            }
            var cde = CdeClient.Load();
            var key = PublishCommand.ProjectKey(doc);
            var link = cde.LinkOf(key);
            if (link == null)
            {
                TaskDialog.Show("SmartEasyBIM — Interferências",
                    "Este modelo ainda não está ligado a um documento do CDE.\n\nUse \"Publicar no CDE\" uma vez: o arquivo fica ligado ao documento e as interferências dele aparecem aqui.");
                return Result.Cancelled;
            }
            if (!cde.LoggedIn || !string.Equals(cde.Url, link.Url, StringComparison.OrdinalIgnoreCase))
            {
                TaskDialog.Show("SmartEasyBIM — Interferências", $"Entre no CDE ({link.Url}) pelo \"Publicar no CDE\" e abra as interferências de novo.");
                return Result.Cancelled;
            }

            if (_selector == null)
            {
                _selector = new ClashSelector();
                _event = ExternalEvent.Create(_selector);
            }
            if (_window != null && !_window.IsDisposed && _windowKey == key)
            {
                _window.Activate();
                return Result.Succeeded;
            }
            _window?.Close();
            _window = new ClashWindow(cde, link, _event, _selector);
            _windowKey = key;
            _window.FormClosed += (s, e) => _window = null;
            // Janela não-modal, por cima do Revit.
            var owner = new RevitWindow(commandData.Application.MainWindowHandle);
            _window.Show(owner);
            return Result.Succeeded;
        }

        private sealed class RevitWindow : System.Windows.Forms.IWin32Window
        {
            public RevitWindow(IntPtr h) { Handle = h; }
            public IntPtr Handle { get; }
        }
    }
}
