// Export a capsule card as a PNG (download, or native share sheet on mobile).
import { toast } from "./ui.js";

async function renderPng(cardEl) {
  if (!window.htmlToImage) throw new Error("Image export library did not load.");
  // Render a clone off-screen at a fixed size so the output is stable regardless of viewport.
  const stage = document.getElementById("share-stage");
  const clone = cardEl.cloneNode(true);
  clone.style.width = "360px";
  clone.style.height = "640px";
  clone.style.maxWidth = "none";
  stage.replaceChildren(clone);
  try {
    // Wait for images in the clone to settle.
    await Promise.all(
      [...clone.querySelectorAll("img")].map(
        (img) =>
          img.complete ||
          new Promise((res) => {
            img.onload = img.onerror = res;
          }),
      ),
    );
    return await window.htmlToImage.toPng(clone, {
      pixelRatio: 3,
      cacheBust: true,
      width: 360,
      height: 640,
      skipFonts: true,
    });
  } finally {
    stage.replaceChildren();
  }
}

function dataUrlToFile(dataUrl, filename) {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

export async function shareCard(cardEl, filename = "sound-capsule.png") {
  toast("Rendering your capsule…", { duration: 8000 });
  let dataUrl;
  try {
    dataUrl = await renderPng(cardEl);
  } catch (e) {
    console.error(e);
    toast("Could not render the card image. Try again or use a screenshot.", { error: true });
    return;
  }
  const file = dataUrlToFile(dataUrl, filename);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My Sound Capsule" });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Saved your capsule as an image.");
}
