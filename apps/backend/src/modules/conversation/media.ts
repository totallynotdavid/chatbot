import { db } from "../../db/index.ts";
import { logAction } from "../../services/audit.ts";
import { notifyTeam } from "../../services/notifier.ts";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

type UploadContractInput = {
  phoneNumber: string;
  userId: string;
  contractFile: File;
  audioFile: File;
  clientName?: string;
  userDisplayName: string;
};

export async function uploadContract(
  input: UploadContractInput,
): Promise<{ success: boolean }> {
  const {
    phoneNumber,
    userId,
    contractFile,
    audioFile,
    clientName,
    userDisplayName,
  } = input;

  const contractsDir = resolve(process.cwd(), "data", "contracts", phoneNumber);
  await mkdir(contractsDir, { recursive: true });

  const contractExt = contractFile.name.split(".").pop() || "pdf";
  const contractPath = join(contractsDir, `contract.${contractExt}`);
  const contractBuffer = await contractFile.arrayBuffer();
  await writeFile(contractPath, Buffer.from(contractBuffer));

  const audioExt = audioFile.name.split(".").pop() || "mp3";
  const audioPath = join(contractsDir, `audio.${audioExt}`);
  const audioBuffer = await audioFile.arrayBuffer();
  await writeFile(audioPath, Buffer.from(audioBuffer));

  const now = Date.now();
  db.prepare(
    `UPDATE conversations 
     SET recording_contract_path = ?, recording_audio_path = ?, recording_uploaded_at = ?
     WHERE phone_number = ?`,
  ).run(
    `contracts/${phoneNumber}/contract.${contractExt}`,
    `contracts/${phoneNumber}/audio.${audioExt}`,
    now,
    phoneNumber,
  );

  logAction(userId, "upload_contract", "conversation", phoneNumber, {
    contractFile: contractFile.name,
    audioFile: audioFile.name,
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const message =
    `📄 Contrato subido\n\n` +
    `Cliente: ${clientName || phoneNumber}\n` +
    `Agente: ${userDisplayName}\n` +
    `Teléfono: ${phoneNumber}\n\n` +
    `Revisar en: ${frontendUrl}/dashboard/conversations/${phoneNumber}`;

  await notifyTeam("sales", message);

  return { success: true };
}
