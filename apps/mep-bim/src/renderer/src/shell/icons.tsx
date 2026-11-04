// Ícones de traço (24 × 24), no estilo das telas propostas do SmartEasyBIM.
import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  importar: (
    <>
      <path d="M12 3 V15" />
      <path d="M7 10 L12 15 L17 10" />
      <path d="M4 19 H20" />
    </>
  ),
  exemplo: (
    <>
      <path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" />
      <path d="M4 7.5 L12 12 L20 7.5" />
      <path d="M12 12 V21" />
    </>
  ),
  abrir: (
    <>
      <path d="M3 7 V18 A1 1 0 0 0 4 19 H20 A1 1 0 0 0 21 18 V9 A1 1 0 0 0 20 8 H11 L9 6 H4 A1 1 0 0 0 3 7 Z" />
    </>
  ),
  salvar: (
    <>
      <path d="M5 3 H16 L21 8 V20 A1 1 0 0 1 20 21 H4 A1 1 0 0 1 3 20 V4 A1 1 0 0 1 4 3 Z" />
      <path d="M7 3 V8 H15 V3" />
      <rect x="7" y="13" width="10" height="8" />
    </>
  ),
  exportar: (
    <>
      <path d="M12 15 V3" />
      <path d="M7 8 L12 3 L17 8" />
      <path d="M4 15 V20 H20 V15" />
    </>
  ),
  sol: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2 V4 M12 20 V22 M2 12 H4 M20 12 H22 M4.9 4.9 L6.3 6.3 M17.7 17.7 L19.1 19.1 M4.9 19.1 L6.3 17.7 M17.7 6.3 L19.1 4.9" />
    </>
  ),
  lua: <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />,
  cores: (
    <>
      <circle cx="8" cy="9" r="4" />
      <circle cx="16" cy="9" r="4" />
      <circle cx="12" cy="16" r="4" />
    </>
  ),
  planta: (
    <>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M3 12 H12 V20" />
      <path d="M12 4 V8" />
    </>
  ),
  "3d": (
    <>
      <path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" />
      <path d="M4 7.5 L12 12 L20 7.5" />
      <path d="M12 12 V21" />
    </>
  ),
  enquadrar: (
    <>
      <path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15" />
    </>
  ),
  corte: (
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="M8.5 8.5 L20 18 M8.5 15.5 L20 6" />
    </>
  ),
  familia: (
    <>
      <path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" />
      <path d="M8 10 H16 M8 13.5 H16 M8 17 H13" />
    </>
  ),
  coordenadas: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2 V7 M12 17 V22 M2 12 H7 M17 12 H22" />
      <path d="M12 2 L10 5 M12 2 L14 5" />
    </>
  ),
  vinculo: (
    <>
      <path d="M10 14 L14 10" />
      <path d="M8.5 12.5 L6.5 14.5 A3 3 0 0 0 10.7 18.7 L12.7 16.7" />
      <path d="M15.5 11.5 L17.5 9.5 A3 3 0 0 0 13.3 5.3 L11.3 7.3" />
    </>
  ),
  selecionar: <path d="M5 3 L19 12 L12.5 13.5 L16 20.5 L13.5 21.5 L10 14.5 L5 19 Z" />,
  propriedades: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11 V17" />
      <path d="M12 7.5 V8" />
    </>
  ),
  quantitativos: (
    <>
      <path d="M8 6 H20 M8 12 H20 M8 18 H20" />
      <path d="M4 6 H4.5 M4 12 H4.5 M4 18 H4.5" />
    </>
  ),
  interferencias: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </>
  ),
  tomada: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="3" />
      <path d="M10 10 V12" />
      <path d="M14 10 V12" />
      <path d="M12 15 V16" />
    </>
  ),
  interruptor: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M10 8 L14 16" />
    </>
  ),
  luminaria: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M7 7 L17 17" />
      <path d="M17 7 L7 17" />
    </>
  ),
  quadro: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M12.5 7 L10 12 H14 L11.5 17" />
    </>
  ),
  dados: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 10 H16 V14 H8 Z" />
      <path d="M10 14 V12 M12 14 V12 M14 14 V12" />
    </>
  ),
  wifi: (
    <>
      <path d="M3 9 A13 13 0 0 1 21 9" />
      <path d="M6.5 12.5 A8 8 0 0 1 17.5 12.5" />
      <path d="M10 16 A3 3 0 0 1 14 16" />
      <path d="M12 19 V19.5" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8 H17 V16 H3 Z" />
      <path d="M17 11 L21 9 V15 L17 13" />
    </>
  ),
  eletroduto: <path d="M3 17 H10 Q13 17 13 14 V7 H21" />,
  eletrodutoFlex: <path d="M3 17 C7 17 7 9 11 9 S15 15 19 13 L21 12" />,
  eletrocalha: (
    <>
      <path d="M3 8 V16 H21 V8" />
      <path d="M7 12 H8 M11 12 H12 M15 12 H16" />
    </>
  ),
  circuito: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8 7.5 L10.5 16" />
      <path d="M16 7.5 L13.5 16" />
    </>
  ),
  calculo: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7 H16" />
      <path d="M8 12 H9 M12 12 H13 M15.5 12 H16 M8 16 H9 M12 16 H13 M15.5 16 H16" />
    </>
  ),
  tubulacao: (
    <>
      <path d="M3 9 H14 Q17 9 17 12 V21" />
      <path d="M3 14 H11 Q12 14 12 15 V21" />
    </>
  ),
  gota: <path d="M12 3 C12 3 6 10 6 14 A6 6 0 0 0 18 14 C18 10 12 3 12 3 Z" />,
  lavatorio: (
    <>
      <path d="M4 10 H20 Q20 17 12 17 Q4 17 4 10 Z" />
      <path d="M12 10 V6 H15" />
    </>
  ),
  bacia: (
    <>
      <path d="M6 4 H14 V10" />
      <path d="M5 10 H19 Q19 16 13 16 L12 20 H9 L10 16 Q5 16 5 10 Z" />
    </>
  ),
  chuveiro: (
    <>
      <path d="M5 4 H12 V7" />
      <path d="M8 7 H16 L15 10 H9 Z" />
      <path d="M10 13 V14 M12 13 V15 M14 13 V14 M11 17 V18 M13 17 V18" />
    </>
  ),
  pia: (
    <>
      <rect x="3" y="9" width="18" height="7" rx="1" />
      <path d="M12 9 V5 H15" />
    </>
  ),
  registro: (
    <>
      <path d="M3 12 H21" />
      <path d="M9 8 L15 16 V8 L9 16 Z" />
    </>
  ),
  ralo: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 9 H16 M7 12 H17 M8 15 H16" />
    </>
  ),
  sprinkler: (
    <>
      <path d="M12 3 V9" />
      <path d="M8 9 H16 L14 13 H10 Z" />
      <path d="M6 17 L4 20 M12 16 V20 M18 17 L20 20" />
    </>
  ),
  detector: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  acionador: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  sirene: (
    <>
      <path d="M6 18 V12 A6 6 0 0 1 18 12 V18 Z" />
      <path d="M4 18 H20" />
      <path d="M12 3 V5 M4.5 6.5 L6 8 M19.5 6.5 L18 8" />
    </>
  ),
  hidrante: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8 V6" />
    </>
  ),
  duto: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <path d="M7 8 V16" />
      <path d="M17 8 V16" />
    </>
  ),
  difusor: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 4 L20 20 M20 4 L4 20" />
    </>
  ),
  grelha: (
    <>
      <rect x="3" y="7" width="18" height="10" />
      <path d="M3 10.5 H21 M3 13.5 H21" />
    </>
  ),
  equipamento: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 8 V12 L15 13" />
    </>
  ),
  evaporadora: (
    <>
      <rect x="3" y="7" width="18" height="8" rx="2" />
      <path d="M6 18 Q8 16 10 18 M14 18 Q16 16 18 18" />
    </>
  ),
  condensadora: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <circle cx="11" cy="12" r="4" />
      <path d="M17 8 V16" />
    </>
  ),
  exaustor: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12 L12 5 Q15 7 12 12 Q19 12 17 15 Z" />
    </>
  ),
  prancha: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M14 15 H21 M14 15 V19" />
      <path d="M6 8 H11 V12 H6 Z" />
    </>
  ),
  painelEsq: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4 V20" />
    </>
  ),
  painelDir: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4 V20" />
    </>
  ),
  // ---- Criar ----
  dLinha: (
    <>
      <path d="M4 19 L20 5" />
      <circle cx="4" cy="19" r="1.6" />
      <circle cx="20" cy="5" r="1.6" />
    </>
  ),
  dArco: (
    <>
      <path d="M4 18 A9 9 0 0 1 20 18" />
      <circle cx="4" cy="18" r="1.6" />
      <circle cx="20" cy="18" r="1.6" />
    </>
  ),
  dCirculo: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12 L18 7" />
    </>
  ),
  dElipse: <ellipse cx="12" cy="12" rx="9" ry="5.5" />,
  dQuadrado: <rect x="5" y="5" width="14" height="14" />,
  dRetangulo: <rect x="3" y="7" width="18" height="10" />,
  dTriangulo: <path d="M12 4 L21 19 H3 Z" />,
  dPoligonal: (
    <>
      <path d="M3 17 L8 7 L14 14 L21 5" />
      <circle cx="3" cy="17" r="1.4" />
      <circle cx="21" cy="5" r="1.4" />
    </>
  ),
  dTexto: (
    <>
      <path d="M5 5 H19 M12 5 V19 M9 19 H15" />
    </>
  ),
  dCotaOrto: (
    <>
      <path d="M4 8 V20 M20 8 V20 M4 12 H20" />
      <path d="M2.5 13.5 L5.5 10.5 M18.5 13.5 L21.5 10.5" />
      <path d="M9 9 H15" />
    </>
  ),
  dCotaInclinada: (
    <>
      <path d="M4 18 L18 4" />
      <path d="M7 21 L21 7" />
      <path d="M5 20 L8 17 M17 8 L20 5" />
    </>
  ),
  dCotaAngular: (
    <>
      <path d="M4 20 H21 M4 20 L16 5" />
      <path d="M13 20 A9 9 0 0 0 10 13" />
    </>
  ),
  // ---- Modificar ----
  mCopiar: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 8 V5 A1 1 0 0 0 15 4 H5 A1 1 0 0 0 4 5 V15 A1 1 0 0 0 5 16 H8" />
    </>
  ),
  mRecortar: (
    <>
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8 16 L18 4 M16 16 L6 4" />
    </>
  ),
  mColar: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="1" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12 H15 M9 16 H13" />
    </>
  ),
  mMover: (
    <>
      <path d="M12 3 V21 M3 12 H21" />
      <path d="M9 6 L12 3 L15 6 M9 18 L12 21 L15 18 M6 9 L3 12 L6 15 M18 9 L21 12 L18 15" />
    </>
  ),
  mApagar: (
    <>
      <path d="M4 7 H20 M9 7 V4 H15 V7" />
      <path d="M6 7 L7 20 H17 L18 7" />
      <path d="M10 11 V16 M14 11 V16" />
    </>
  ),
  mEstender: (
    <>
      <path d="M20 3 V21" />
      <path d="M3 12 H10" />
      <path d="M10 12 H19" strokeDasharray="2 2" />
      <path d="M16 9 L19 12 L16 15" />
    </>
  ),
  mConectar: (
    <>
      <path d="M4 18 H12 V6" />
      <circle cx="12" cy="18" r="2" />
      <path d="M17 6 H21 M4 6 H8" strokeDasharray="2 2" />
    </>
  ),
  // ---- Geral ----
  gIndicar: (
    <>
      <circle cx="7" cy="17" r="2.5" />
      <path d="M8.8 15.2 L14 10 H21" />
      <path d="M14 6.5 H20" />
    </>
  ),
  gCorteLinha: (
    <>
      <path d="M4 20 L20 4" />
      <path d="M3 9 L9 3 M15 21 L21 15" />
      <path d="M6 6 L3 9 M18 18 L21 15" />
    </>
  ),
  gSemCorte: (
    <>
      <path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" />
      <path d="M4 4 L20 20" />
    </>
  ),
  gMedDist: (
    <>
      <path d="M3 15 L21 15 M3 12 V18 M21 12 V18" />
      <path d="M6 15 L8 13 M6 15 L8 17 M18 15 L16 13 M18 15 L16 17" />
      <path d="M8 8 H16" strokeDasharray="2 2" />
    </>
  ),
  gMedArea: (
    <>
      <path d="M4 18 L7 5 L19 8 L17 19 Z" />
      <path d="M9 14 H13 M11 12 V16" />
    </>
  ),
  gMedAng: (
    <>
      <path d="M4 19 H20 M4 19 L15 5" />
      <path d="M11 19 A7 7 0 0 0 8.5 14" />
    </>
  ),
  gAmpliacao: (
    <>
      <rect x="3" y="3" width="11" height="9" strokeDasharray="2 2" />
      <circle cx="16" cy="16" r="4.5" />
      <path d="M19.2 19.2 L22 22 M14 16 H18 M16 14 V18" />
    </>
  ),
  gVista3d: (
    <>
      <circle cx="6" cy="16" r="2.5" />
      <path d="M8 14.5 L20 6 M8 17 L21 13" />
      <path d="M20 6 L21 13" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 22, color = "currentColor", stroke = 1.8 }: { name: string; size?: number; color?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/** Logotipo: cubo isométrico com as três linhas das disciplinas e o nó ciano. */
export function LogoMark({ size = 28, light = true }: { size?: number; light?: boolean }) {
  const line = light ? "#E2E8F0" : "#0B1B33";
  const small = size <= 32;
  const w = small ? 4.5 : 3.5;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M32 6 L54 18.5 V45.5 L32 58 L10 45.5 V18.5 Z" stroke={line} strokeWidth={w} strokeLinejoin="round" />
      <path d="M10 18.5 L32 31 L54 18.5" stroke={line} strokeWidth={w} strokeLinejoin="round" />
      <path d="M32 31 V58" stroke={line} strokeWidth={w} />
      {!small && (
        <>
          <path d="M17 27 V40" stroke="#FBBF24" strokeWidth={w} strokeLinecap="round" />
          <path d="M24 31 V44" stroke="#38BDF8" strokeWidth={w} strokeLinecap="round" />
          <path d="M40 31 V44" stroke="#2DD4BF" strokeWidth={w} strokeLinecap="round" />
        </>
      )}
      <circle cx="32" cy="31" r={small ? 6 : 4.5} fill="#22D3EE" />
    </svg>
  );
}
