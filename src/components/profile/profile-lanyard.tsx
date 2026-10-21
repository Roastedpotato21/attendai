import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, RotateCw, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { prepareStaffPhoto, saveStaffPhoto } from "@/lib/services/staff-photo";
import { staffPhotoKey, useStaffPhoto } from "./use-staff-photo";
import "./profile-lanyard.css";
import "./lanyard/lanyard.css";
const Lanyard = lazy(() => import("./lanyard/lanyard"));

/** Only used until the person uploads their own image. */
function emptyBadgeFace(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#f4f4f4";
  context.fillRect(0, 0, 640, 900);
  context.fillStyle = "#777777";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "100px Arial, sans-serif";
  context.fillText(
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase(),
    320,
    450,
  );
  return canvas.toDataURL("image/png");
}

export function ProfileLanyard({
  institution,
  name,
  role,
}: {
  institution: string;
  name: string;
  role: string;
}) {
  const { user } = useAuth();
  const query = useStaffPhoto(institution);
  const cache = useQueryClient();
  const photo = query.data?.data_url ?? null;
  const [placeholder, setPlaceholder] = useState<string>();
  const face = photo ?? placeholder;

  const [motion, setMotion] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPlaceholder(emptyBadgeFace(name));
  }, [name]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new MutationObserver(() =>
      setRendered(!!element.querySelector("[data-rendered=true]")),
    );
    observer.observe(element, { attributes: true, subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);
  async function save(next: string | null) {
    setBusy(true);
    setError("");
    try {
      const data = await saveStaffPhoto(institution, next);
      cache.setQueryData(staffPhotoKey(user?.id, institution), data);
      setOpen(false);
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The photo could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-lanyard" aria-label="Your profile badge">
      <div
        className="profile-lanyard-stage"
        ref={ref}
        role="img"
        aria-label={`Profile badge for ${name}, ${role}`}
      >
        <div className="profile-badge-fallback" hidden={motion && rendered}>
          <span className="profile-badge-strap" />
          <div>{face && <img src={face} alt="" />}</div>
        </div>
        {motion && face && (
          <Suspense fallback={null}>
            <Lanyard frontImage={face} backImage={face} imageFit="cover" />
          </Suspense>
        )}
      </div>
      <div className="profile-lanyard-controls">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setError("");
            setPreview(null);
            setOpen(true);
          }}
          aria-label={photo ? "Change profile photo" : "Add profile photo"}
        >
          <ImagePlus size={13} />
          {photo ? "Change photo" : "Add photo"}
        </Button>
        {motion && rendered && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Flip profile badge"
            onClick={() =>
              ref.current?.querySelector(".lanyard")?.dispatchEvent(new Event("attendai:flip"))
            }
          >
            <RotateCw size={13} />
          </Button>
        )}
      </div>
      <span className="profile-lanyard-hint">
        {motion && rendered ? "Drag to swing · click to flip" : "Your profile badge"}
      </span>
      {query.isError && (
        <p role="alert" className="profile-lanyard-error">
          Profile photo could not be loaded. Check the photo migration and workspace access.
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Your profile photo</DialogTitle>
            <DialogDescription>
              Choose a PNG or JPEG up to 4 MiB. It is cropped to a portrait and stored privately in
              this institution workspace. This display photo grants no permissions.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm">
            Photo
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                void prepareStaffPhoto(file)
                  .then(setPreview)
                  .catch((reason) =>
                    setError(
                      reason instanceof Error ? reason.message : "This image could not be read.",
                    ),
                  )
                  .finally(() => setBusy(false));
                event.target.value = "";
              }}
            />
          </label>
          {(preview ?? photo) && (
            <img
              src={preview ?? photo ?? undefined}
              alt="Profile photo preview"
              className="mx-auto h-48 w-36 rounded object-cover"
            />
          )}
          {preview && <p className="text-sm text-muted-foreground">Preview — save to apply.</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !preview} onClick={() => void save(preview)}>
              <Check size={14} />
              {busy ? "Saving…" : "Save photo"}
            </Button>
            {photo && (
              <Button variant="outline" disabled={busy} onClick={() => void save(null)}>
                <Trash2 size={14} />
                Remove photo
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
