// Faixa de ferramentas da aba superior ativa.
import { Icon } from "./icons";
import { disciplineOfTab, RIBBON, sameTool, type ActionId, type RibbonButton, type ToolSpec, type TopTab } from "./ribbonConfig";

interface Props {
  tab: TopTab;
  tool: ToolSpec;
  hasModel: boolean;
  /** Estados ligados de botões de ação (tema, cores, corte, vista). */
  pressed: Partial<Record<ActionId, boolean>>;
  onTool: (t: ToolSpec) => void;
  onAction: (a: ActionId) => void;
}

export function Ribbon({ tab, tool, hasModel, pressed, onTool, onAction }: Props) {
  const disc = disciplineOfTab(tab);
  const style = disc ? ({ "--disc": disc.color, "--disc-text": disc.text } as React.CSSProperties) : undefined;
  const isOn = (b: RibbonButton) => (b.tool ? sameTool(b.tool, tool) : b.action ? !!pressed[b.action] : false);
  return (
    <div className={`ribbon ${disc ? "disc" : ""}`} style={style} role="toolbar" aria-label="Ferramentas">
      {RIBBON[tab].map((g) => (
        <div key={g.label} className="ribbon-group">
          <div className="ribbon-buttons">
            {g.buttons.map((b) => (
              <button
                key={b.key}
                className={`ribbon-btn ${isOn(b) ? "on" : ""}`}
                disabled={b.needsModel && !hasModel}
                onClick={() => (b.tool ? onTool(b.tool) : b.action && onAction(b.action))}
                title={b.label}
              >
                <Icon name={b.icon} size={22} />
                <span>{b.label}</span>
              </button>
            ))}
          </div>
          <div className="ribbon-label">{g.label}</div>
        </div>
      ))}
    </div>
  );
}
