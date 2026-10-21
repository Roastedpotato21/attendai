import { setupRpc } from "./staff-setup";
export type StaffPhoto = { data_url: string | null; revision: number; updated_at?: string };
export const readStaffPhoto = (institution: string) =>
  setupRpc<StaffPhoto>("my_staff_profile_photo", { p_institution: institution });
export const saveStaffPhoto = (institution: string, dataUrl: string | null) => {
  const match = dataUrl?.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (dataUrl && !match) throw new Error("Use a PNG or JPEG profile photo.");
  return setupRpc<StaffPhoto>("save_my_staff_profile_photo", {
    p_institution: institution,
    p_mime: match?.[1] ?? null,
    p_base64: match?.[2] ?? null,
  });
};

/** Decode and re-encode rather than storing the original metadata or file name. */
export async function prepareStaffPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 4 * 1024 * 1024)
    throw new Error("Choose a PNG/JPEG photo up to 4 MiB.");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((file.type === "image/png" && !png) || (file.type === "image/jpeg" && !jpeg))
    throw new Error("The image type does not match the file contents.");
  const image = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (
      !image.width ||
      !image.height ||
      image.width > 8192 ||
      image.height > 8192 ||
      image.width * image.height > 20_000_000
    )
      throw new Error("Use a photo no larger than 20 megapixels or 8192 pixels per side.");
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 384, 512);
    const cropWidth = Math.min(image.width, image.height * 0.75);
    const cropHeight = cropWidth / 0.75;
    context.drawImage(
      image,
      (image.width - cropWidth) / 2,
      (image.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      384,
      512,
    );
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if ((result.split(",")[1]?.length ?? Infinity) * 0.75 <= 131072) return result;
    }
    throw new Error("The processed photo exceeds 128 KiB. Choose a simpler photo.");
  } finally {
    image.close();
  }
}
