import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGenerateMemes } from "@workspace/api-client-react";
import type { MemeItem, MemeGenerateInputLanguage } from "@workspace/api-client-react";
import { useCredits } from "@/hooks/use-credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Settings, Loader2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AdRewardWall } from "@/components/AdRewardWall";

const TwitterIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
  </svg>
);
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const LOADING_MESSAGES_ES = [
  "📥 Descargando video...",
  "🤖 Gemini está analizando tu video...",
  "🎭 Creando tus memes...",
];

const LOADING_MESSAGES_EN = [
  "📥 Downloading video...",
  "🤖 Gemini is analyzing your video...",
  "🎭 Creating your memes...",
];

async function downloadMeme(imageUrl: string, filename: string) {
  try {
    if (imageUrl.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = imageUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    const proxyUrl = `/api/memes/download-proxy?url=${encodeURIComponent(imageUrl)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Proxy failed");
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(imageUrl, "_blank");
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState<MemeGenerateInputLanguage>("en");
  const { credits, addCredits, deductCredit } = useCredits();
  const [showAdWall, setShowAdWall] = useState(false);
  const [memes, setMemes] = useState<MemeItem[]>([]);
  const [videoTitle, setVideoTitle] = useState("");
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const { toast } = useToast();
  const generateMutation = useGenerateMemes();

  useEffect(() => {
    let interval: number;
    if (generateMutation.isPending) {
      interval = window.setInterval(() => {
        setLoadingMsgIdx((prev) => (prev + 1) % 3);
      }, 5000);
    } else {
      setLoadingMsgIdx(0);
    }
    return () => window.clearInterval(interval);
  }, [generateMutation.isPending]);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || (!trimmed.includes("youtube.com") && !trimmed.includes("youtu.be"))) {
      toast({
        title: language === "es" ? "URL inválida" : "Invalid URL",
        description:
          language === "es"
            ? "Por favor ingresa un link de YouTube válido."
            : "Please enter a valid YouTube link.",
        variant: "destructive",
      });
      return;
    }

    if (credits <= 0) {
      setShowAdWall(true);
      return;
    }

    generateMutation.mutate(
      { data: { youtube_url: trimmed, language } },
      {
        onSuccess: (data) => {
          setMemes(data.memes);
          setVideoTitle(data.video_title || "");
          deductCredit();
          toast({
            title: language === "es" ? "¡Memes generados! 🎉" : "Memes generated! 🎉",
            description:
              language === "es"
                ? `${data.memes.length} memes de "${data.video_title}"`
                : `${data.memes.length} memes from "${data.video_title}"`,
          });
        },
        onError: (err: unknown) => {
          const message =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            (language === "es"
              ? "Ocurrió un error al generar memes. Revisa que el video sea público."
              : "Error generating memes. Make sure the video is public.");
          toast({
            title: "Error",
            description: message,
            variant: "destructive",
          });
        },
      }
    );
  };

  const loadingMessages = language === "es" ? LOADING_MESSAGES_ES : LOADING_MESSAGES_EN;

  const gridItems: React.ReactNode[] = [];
  memes.forEach((meme, idx) => {
    gridItems.push(
      <motion.div
        key={`meme-${idx}`}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: idx * 0.08 }}
      >
        <Card
          className="bg-card overflow-hidden hover:border-primary/60 transition-all duration-200 hover:shadow-lg hover:shadow-primary/10 h-full"
          data-testid={`card-meme-${idx}`}
        >
          <div className="relative">
            <img
              src={meme.image_url}
              alt={meme.top_text}
              className="w-full object-cover aspect-square bg-muted"
              loading="lazy"
            />
            <div className="absolute top-2 left-2 flex flex-col gap-1">
              <Badge className="bg-black/80 text-white border-none text-xs backdrop-blur-sm">
                {meme.template_name}
              </Badge>
              <Badge className="bg-primary text-black border-none text-xs font-mono w-fit">
                {meme.timestamp}
              </Badge>
            </div>
          </div>
          <CardContent className="p-4 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground line-clamp-2 italic">
              "{meme.what_happens}"
            </p>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex gap-1.5">
                <button
                  className="h-8 w-8 rounded-full bg-black hover:bg-zinc-800 text-white flex items-center justify-center transition-colors"
                  onClick={() =>
                    window.open(
                      `https://twitter.com/intent/tweet?text=${encodeURIComponent(meme.top_text)}&url=${encodeURIComponent(meme.image_url)}`,
                      "_blank"
                    )
                  }
                  title="Share on X"
                  data-testid={`button-share-twitter-${idx}`}
                >
                  <TwitterIcon />
                </button>
                <button
                  className="h-8 w-8 rounded-full bg-[#25D366] hover:bg-[#1ebe5d] text-white flex items-center justify-center transition-colors"
                  onClick={() =>
                    window.open(
                      `https://wa.me/?text=${encodeURIComponent(meme.top_text + " " + meme.image_url)}`,
                      "_blank"
                    )
                  }
                  title="Share on WhatsApp"
                  data-testid={`button-share-whatsapp-${idx}`}
                >
                  <WhatsAppIcon />
                </button>
                <button
                  className="h-8 w-8 rounded-full bg-[#1877F2] hover:bg-[#1565d8] text-white flex items-center justify-center transition-colors"
                  onClick={() =>
                    window.open(
                      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(meme.image_url)}`,
                      "_blank"
                    )
                  }
                  title="Share on Facebook"
                  data-testid={`button-share-facebook-${idx}`}
                >
                  <FacebookIcon />
                </button>
              </div>
              <button
                className="h-8 w-8 rounded-full bg-secondary hover:bg-secondary/70 text-foreground flex items-center justify-center transition-colors hover:text-primary"
                onClick={() => downloadMeme(meme.image_url, `meme-${idx + 1}.jpg`)}
                title="Download"
                data-testid={`button-download-${idx}`}
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );

    if ((idx + 1) % 4 === 0) {
      gridItems.push(
        <div
          key={`ad-${idx}`}
          className="bg-card border border-dashed border-muted rounded-lg flex items-center justify-center text-muted-foreground text-xs p-4 min-h-[250px]"
        >
          {/* PEGA AQUÍ TU SCRIPT ADSTERRA 300x250 RECTANGLE */}
        </div>
      );
    }
  });

  return (
    <div className="min-h-screen pb-24 font-sans selection:bg-primary selection:text-black">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-7 h-7 text-primary" />
          <h1 className="text-2xl md:text-3xl font-display tracking-wide text-white">
            Meme<span className="text-primary">Factory</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLanguage(language === "en" ? "es" : "en")}
            className="border border-border bg-card hover:border-primary/50 transition-colors px-3 py-1.5 rounded-md font-bold text-sm flex items-center gap-1.5"
            data-testid="button-toggle-language"
          >
            {language === "en" ? "🇺🇸 EN" : "🇪🇸 ES"}
          </button>
          <div className="bg-card border border-border px-3 py-1.5 rounded-md font-mono font-bold flex items-center gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              {language === "es" ? "CRÉDITOS" : "CREDITS"}
            </span>
            <span className={`text-lg leading-none ${credits === 0 ? "text-red-500" : "text-primary"}`}>
              {credits}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-8 flex flex-col items-center">
        {/* Desktop leaderboard ad */}
        <div className="hidden md:flex w-full max-w-[728px] h-[90px] bg-card border border-dashed border-muted rounded items-center justify-center text-muted-foreground text-xs mb-8">
          {/* PEGA AQUÍ TU SCRIPT ADSTERRA 728x90 LEADERBOARD */}
        </div>

        {/* Input Section */}
        <div className="w-full max-w-2xl mb-10">
          <form onSubmit={handleGenerate} className="flex flex-col gap-3">
            <div className="relative">
              <Play className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5 pointer-events-none" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="pl-12 h-14 text-base bg-card/60 border-border focus-visible:border-primary focus-visible:ring-primary text-white placeholder:text-muted-foreground/60"
                data-testid="input-youtube-url"
                disabled={generateMutation.isPending}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-14 text-xl font-display tracking-widest uppercase bg-primary hover:bg-primary/90 text-black transition-all active:scale-[0.98]"
              disabled={generateMutation.isPending}
              data-testid="button-generate"
            >
              {generateMutation.isPending ? (
                <span className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {loadingMessages[loadingMsgIdx]}
                </span>
              ) : (
                "GENERATE MEMES 🔥"
              )}
            </Button>
          </form>
        </div>

        {/* Video title */}
        <AnimatePresence>
          {videoTitle && memes.length > 0 && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-muted-foreground mb-6 text-center max-w-xl truncate"
            >
              🎬 {videoTitle}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Memes Grid */}
        {gridItems.length > 0 && (
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {gridItems}
          </div>
        )}
      </main>

      {/* Mobile bottom ad banner */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-[50px] bg-card/95 border-t border-border flex items-center justify-center text-muted-foreground text-xs z-30 backdrop-blur-sm">
        {/* PEGA AQUÍ TU SCRIPT ADSTERRA 320x50 MOBILE BANNER */}
      </div>

      {showAdWall && (
        <AdRewardWall
          language={language}
          onRewardClaimed={(earned) => {
            addCredits(earned);
            setShowAdWall(false);
          }}
        />
      )}
    </div>
  );
}
