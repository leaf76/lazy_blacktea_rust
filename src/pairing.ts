export type PairingMode = "qr" | "code";
export type PairingStatus =
  | "idle"
  | "pairing"
  | "paired"
  | "pairing_error"
  | "connecting"
  | "connected"
  | "connect_error";

export type PairingState = {
  isOpen: boolean;
  status: PairingStatus;
  mode: PairingMode;
  qrPayload: string;
  pairAddress: string;
  pairingCode: string;
  connectAddress: string;
  message?: string;
  error?: string;
};

export type PairingAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_MODE"; mode: PairingMode }
  | { type: "SET_QR_PAYLOAD"; value: string }
  | { type: "SET_PAIR_ADDRESS"; value: string }
  | { type: "SET_PAIR_CODE"; value: string }
  | { type: "SET_CONNECT_ADDRESS"; value: string }
  | { type: "PAIR_START" }
  | { type: "PAIR_SUCCESS"; message: string; connectAddress?: string }
  | { type: "PAIR_ERROR"; error: string }
  | { type: "CONNECT_START" }
  | { type: "CONNECT_SUCCESS"; message: string }
  | { type: "CONNECT_ERROR"; error: string }
  | { type: "RESET" };

export const initialPairingState: PairingState = {
  isOpen: false,
  status: "idle",
  mode: "qr",
  qrPayload: "",
  pairAddress: "",
  pairingCode: "",
  connectAddress: "",
  message: undefined,
  error: undefined,
};

export const pairingReducer = (state: PairingState, action: PairingAction): PairingState => {
  switch (action.type) {
    case "OPEN":
      return { ...initialPairingState, isOpen: true };
    case "CLOSE":
      return { ...initialPairingState };
    case "RESET":
      return { ...initialPairingState, isOpen: state.isOpen };
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "SET_QR_PAYLOAD":
      return { ...state, qrPayload: action.value };
    case "SET_PAIR_ADDRESS":
      return { ...state, pairAddress: action.value };
    case "SET_PAIR_CODE":
      return { ...state, pairingCode: action.value };
    case "SET_CONNECT_ADDRESS":
      return { ...state, connectAddress: action.value };
    case "PAIR_START":
      return { ...state, status: "pairing", error: undefined, message: undefined };
    case "PAIR_SUCCESS":
      return {
        ...state,
        status: "paired",
        message: action.message,
        error: undefined,
        connectAddress: action.connectAddress ?? state.connectAddress,
      };
    case "PAIR_ERROR":
      return { ...state, status: "pairing_error", error: action.error };
    case "CONNECT_START":
      return { ...state, status: "connecting", error: undefined, message: undefined };
    case "CONNECT_SUCCESS":
      return { ...state, status: "connected", message: action.message, error: undefined };
    case "CONNECT_ERROR":
      return { ...state, status: "connect_error", error: action.error };
    default:
      return state;
  }
};

const hostPortRegex = /([a-zA-Z0-9.-]+:\d{2,5})/;

export const extractHostPort = (input: string) => {
  const match = input.match(hostPortRegex);
  return match ? match[1] : "";
};

export const extractPairingCode = (input: string) => {
  const match = input.match(/\b(\d{6})\b/);
  return match ? match[1] : "";
};

export const parseAdbPairOutput = (output: string) => {
  const connectAddress = extractHostPort(output);
  return {
    connectAddress,
    message: output.trim(),
  };
};

export const parseQrPayload = (payload: string) => {
  const trimmed = payload.trim();
  if (!trimmed) {
    return { pairAddress: "", pairingCode: "" };
  }

  let pairAddress = "";
  let pairingCode = "";

  if (trimmed.includes("WIFI:") || trimmed.includes("ADB")) {
    const segments = trimmed.split(";").map((item) => item.trim());
    for (const segment of segments) {
      if (segment.startsWith("S:")) {
        pairAddress = segment.slice(2);
      }
      if (segment.startsWith("P:")) {
        pairingCode = segment.slice(2);
      }
    }
  }

  if (!pairAddress) {
    pairAddress = extractHostPort(trimmed);
  }
  if (!pairingCode) {
    pairingCode = extractPairingCode(trimmed);
  }

  return { pairAddress, pairingCode };
};
