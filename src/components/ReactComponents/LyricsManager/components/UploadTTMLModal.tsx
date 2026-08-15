import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { SpotifyPlayer } from "../../../../components/Global/SpotifyPlayer";
import { useLocalLyricsOverride } from "../../../../utils/Lyrics/fetchLyrics";
import ApplyLyrics from "../../../../utils/Lyrics/Global/Applyer";
import { LocalLyricsManager } from "../../../../utils/Lyrics/manager";
import { getLyricsOverridePreference } from "../../../../utils/Lyrics/LyricsOverridePreference.ts";
import { IconButton } from "./IconButton";
import { ArrowLeftIcon, UploadIcon } from "./Icons";

type UploadMode = "persistent" | "temporary";

type UploadTTMLModalProps = {
  onBack: () => void;
  onDone: (mode: UploadMode) => void;
};

export default function UploadTTMLModal({ onBack, onDone }: UploadTTMLModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<UploadMode>("persistent");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openedTrack = useRef({
    uri: SpotifyPlayer.GetUri(),
    title: SpotifyPlayer.GetName() ?? "Unknown Song",
  }).current;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  }

  async function handleUpload() {
    if (!file || uploading) return;

    const uri = openedTrack.uri;
    if (!uri) {
      toast.error("No track is currently playing.", { duration: 5000 });
      return;
    }

    if (SpotifyPlayer.GetUri() !== uri) {
      toast.error("The playing track changed. Reopen Upload Lyrics and try again.", {
        duration: 5000,
      });
      return;
    }

    setUploading(true);
    const progressToast = toast.loading("Reading and applying lyrics…");
    let previousRaw: string | null = null;
    let storedRaw = false;
    let committed = false;
    try {
      const rawSource = await file.text();
      if (SpotifyPlayer.GetUri() !== uri) {
        toast.error("The playing track changed. Nothing was applied.", { duration: 5000 });
        return;
      }
      if (!LocalLyricsManager.parseRaw(rawSource)) {
        toast.error("Failed to parse lyrics.", { duration: 5000 });
        return;
      }
      const previousPreference = await getLyricsOverridePreference(uri);
      previousRaw = mode === "persistent" ? await LocalLyricsManager.getRaw(uri) : null;
      if (SpotifyPlayer.GetUri() !== uri) {
        toast.error("The playing track changed. Nothing was applied.", { duration: 5000 });
        return;
      }
      if (mode === "persistent") {
        await LocalLyricsManager.put(uri, rawSource);
        storedRaw = true;
        if (SpotifyPlayer.GetUri() !== uri) {
          if (previousRaw === null) await LocalLyricsManager.remove(uri);
          else await LocalLyricsManager.put(uri, previousRaw);
          storedRaw = false;
          toast.error("The playing track changed. Nothing was applied.", { duration: 5000 });
          return;
        }
      }
      const lyrics = await useLocalLyricsOverride(uri, rawSource, mode, { previousPreference });
      if (!lyrics || SpotifyPlayer.GetUri() !== uri) {
        if (storedRaw) {
          if (previousRaw === null) await LocalLyricsManager.remove(uri);
          else await LocalLyricsManager.put(uri, previousRaw);
          storedRaw = false;
        }
        toast.error(
          SpotifyPlayer.GetUri() === uri
            ? "Could not apply lyrics. Nothing was saved."
            : "The playing track changed. Nothing was applied.",
          { duration: 5000 }
        );
        return;
      }
      storedRaw = false;
      committed = true;
      await ApplyLyrics(lyrics);
      toast.success(
        mode === "persistent" ? "Lyrics saved and applied." : "Lyrics applied for this session.",
        { duration: 5000 }
      );
      onDone(mode);
    } catch (err) {
      if (storedRaw) {
        try {
          if (previousRaw === null) await LocalLyricsManager.remove(uri);
          else await LocalLyricsManager.put(uri, previousRaw);
        } catch (rollbackError) {
          console.error("Lyrics upload rollback error:", rollbackError);
        }
      }
      toast.error(
        committed ? "Lyrics were selected but could not be displayed." : "Upload failed.",
        { duration: 5000 }
      );
      console.error("Lyrics upload error:", err);
    } finally {
      toast.dismiss(progressToast);
      setUploading(false);
    }
  }

  return (
    <div className="sl-ldb-upload-root">
      <div className="sl-ldb-upload-header">
        <h2 className="sl-ldb-upload-title">Upload Lyrics</h2>
        <p className="sl-ldb-upload-subtitle">For: {openedTrack.title}</p>
      </div>

      <div className="sl-ldb-upload-file-section">
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttml"
          id="sl-ldb-file-input"
          className="sl-ldb-file-input"
          onChange={handleFileChange}
        />
        <label htmlFor="sl-ldb-file-input" className="sl-ldb-file-label">
          {file ? file.name : "Choose .ttml file…"}
        </label>
      </div>

      <div className="sl-ldb-upload-mode-section">
        <button
          type="button"
          className={`sl-ldb-upload-mode-card${mode === "persistent" ? " sl-ldb-upload-mode-card--active" : ""}`}
          onClick={() => setMode("persistent")}
        >
          <span className="sl-ldb-upload-mode-title">Persistent</span>
          <span className="sl-ldb-upload-mode-desc">Stored in local DB, survives restarts</span>
        </button>
        <button
          type="button"
          className={`sl-ldb-upload-mode-card${mode === "temporary" ? " sl-ldb-upload-mode-card--active" : ""}`}
          onClick={() => setMode("temporary")}
        >
          <span className="sl-ldb-upload-mode-title">This Session</span>
          <span className="sl-ldb-upload-mode-desc">
            Applied only to current song until refresh
          </span>
        </button>
      </div>

      <p className="sl-ldb-upload-parser-note">
        TTML is parsed on your device. Persistent files stay in your local DB and load without
        sending their contents anywhere.
      </p>

      <div className="sl-ldb-upload-actions">
        <IconButton
          icon={<ArrowLeftIcon size={14} />}
          label="Back"
          variant="default"
          onClick={onBack}
          disabled={uploading}
        />
        <IconButton
          icon={<UploadIcon size={14} />}
          label={uploading ? "Uploading…" : "Upload"}
          variant="primary"
          onClick={handleUpload}
          disabled={!file || uploading}
        />
      </div>
    </div>
  );
}
