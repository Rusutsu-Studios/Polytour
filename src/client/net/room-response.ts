import { z } from "zod";
import type { RoomCredentials } from "../../shared/protocol/index.js";
import { RoomCodeSchema } from "../../shared/protocol/index.js";

export const RoomCredentialsSchema = z.object({
  roomCode: RoomCodeSchema,
  seat: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  token: z.string().min(1),
});

const roomError = z.object({
  error: z.string().optional(),
  message: z.string().trim().min(1).max(300).optional(),
});
const ERROR_MESSAGES: Record<string, string> = {
  "room-not-found":
    "Cette salle n’existe pas. Vérifiez les six caractères du code.",
  "room-full": "Cette salle est complète. Créez une nouvelle partie.",
  "game-started": "La partie a déjà commencé. Rejoignez un autre salon.",
  "invalid-room":
    "Le nom ou les réglages de la salle sont invalides. Vérifiez-les puis réessayez.",
  "origin-rejected":
    "Cette page ne peut pas ouvrir de salle. Revenez à l’adresse du jeu.",
  "room-service-unavailable":
    "Le serveur de jeu est temporairement indisponible (HTTP 503). Patientez un instant puis réessayez.",
  "room-storage-limit":
    "Le quota quotidien d’écriture des salles Cloudflare est atteint (HTTP 503). Réessayez après sa réinitialisation.",
};

export class RoomRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RoomRequestError";
    this.status = status;
  }
}

function unavailableMessage(status: number): string {
  if (status === 429)
    return "Le service reçoit trop de demandes (HTTP 429). Attendez un moment puis réessayez.";
  if (status >= 500)
    return `Le serveur de jeu est temporairement indisponible (HTTP ${status}). Patientez un instant puis réessayez.`;
  return `Impossible d’ouvrir la salle (HTTP ${status}). Réessayez.`;
}

export async function parseRoomResponse(
  response: Response,
): Promise<RoomCredentials> {
  // A Cloudflare platform failure may be plain text or HTML, even for /api.
  // Read it once and validate it before using or persisting any credentials.
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const parsed = roomError.safeParse(body);
    const error = parsed.success ? parsed.data : null;
    throw new RoomRequestError(
      ERROR_MESSAGES[error?.error ?? ""] ??
        error?.message ??
        unavailableMessage(response.status),
      response.status,
    );
  }
  const credentials = RoomCredentialsSchema.safeParse(body);
  if (!credentials.success)
    throw new RoomRequestError(
      "Le serveur a envoyé une réponse de salle incompatible. Actualisez la page puis réessayez.",
      response.status,
    );
  return credentials.data;
}
