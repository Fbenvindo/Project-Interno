// Contrato entre o editor em planta e as ferramentas de desenho/modificação/vistas.
import type { Prim } from "../../../core/plan/drawing";
import type { P2 } from "../../../core/plan/section";

export interface ClickInfo {
  /** Elemento sob o cursor (id da cena: IFC, ponto, segmento, desenho) ou null. */
  id: number | null;
  /** Aresta de parede cortada mais próxima (para estender até a parede). */
  edge: [P2, P2] | null;
  shift: boolean;
  ctrl: boolean;
}

export interface ToolQuestion {
  text: string;
  options: { label: string; primary?: boolean; run: () => void }[];
}

export interface PlanTool {
  /** Instrução atual (mostrada sobre a planta). */
  prompt: string;
  /** Pergunta pendente (ex.: remover itens da seleção) com botões. */
  question?: ToolQuestion | null;
  /** Fase de seleção: arrastar com o botão esquerdo desenha uma janela de seleção. */
  selecting: boolean;
  /** Os cliques indicam pontos (encaixe em extremidades, meios, centros e vértices). */
  snap: boolean;
  /** Ponto de referência para o modo ortogonal (Shift). */
  anchor: P2 | null;
  /** Pré-visualização para a posição do cursor (coordenadas do projeto). */
  preview(cursor: P2 | null): Prim[];
  click(p: P2, info: ClickInfo): void;
  /** Janela (esquerda→direita, só o que está totalmente dentro) ou cruzamento (direita→esquerda). */
  box?(ids: number[], info: { shift: boolean; ctrl: boolean }): void;
  /** Enter, duplo clique ou botão direito. */
  finish(): void;
  /** Esc. */
  cancel(): void;
  /** Texto sendo digitado no local (comando Texto): Enter grava, Esc desiste. */
  textInput?: { at: P2; value: string; onCommit: (text: string) => void; onCancel: () => void } | null;
}
