import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGenerateMemes } from "@workspace/api-client-react";
import type { MemeItem, MemeGenerateInputLanguage } from "@workspace/api-client-react/src/generated/api.schemas";
import { useCredits } from "@/hooks/use-credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Share2, Settings, Loader2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadImage } from "@/lib/download";
import { AdRewardWall } from "@/components/AdRewardWall";

const TwitterIcon = () => (<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path></svg>);
const WhatsAppIcon = () => (<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>);
const FacebookIcon = () => (<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>);

const LOADING_MESSAGES_ES = [
  "📥 Descargando video...",
  "🤖 Gemini está analizando tu video...",
  "🎭 Creando tus memes..."
];

const LOADING_MESSAGES_EN = [
  "📥 Downloading video...",
  "🤖 Gemini is analyzing your video...",
  "🎭 Creating your memes..."
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState<MemeGenerateInputLanguage>("en");
  const { credits, addCredits, deductCredit } = useCredits();
  const [showAdWall, setShowAdWall] = useState(false);
  const [memes, setMemes] = useState<MemeItem[]>([]);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);

  const { toast } = useToast();
  const generateMutation = useGenerateMemes();

  useEffect(() => {
    let interval: number;
    if (generateMutation.isPending) {
      interval = window.setInterval(() => {
        setLoadingMsgIdx(prev => (prev + 1) % 3);
      }, 5000);
    } else {
      setLoadingMsgIdx(0);
    }
    return () => window.clearInterval(interval);
  }, [generateMutation.isPending]);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !url.includes("youtube.com") && !url.includes("youtu.be")) {
      toast({
        title: language === "es" ? "URL inválida" : "Invalid URL",
        description: language === "es" ? "Por favor ingresa un link de YouTube válido." : "Please enter a valid YouTube link.",
        variant: "destructive"
      });
      return;
    }

    if (credits <= 0) {
      setShowAdWall(true);
      return;
    }

    generateMutation.mutate({ data: { youtube_url: url, language } }, {
      onSuccess: (data) => {
        setMemes(data.memes);
        deductCredit();
        toast({
          title: language === "es" ? "¡Memes generados!" : "Memes generated!",
          description: language === "es" ? "Aquí están tus obras maestras." : "Here are your masterpieces.",
        });
      },
      onError: () => {
        toast({
          title: "Error",
          description: language === "es" ? "Ocurrió un error al generar memes." : "An error occurred generating memes.",
          variant: "destructive"
        });
      }
    });
  };

  const loadingMessages = language === "es" ? LOADING_MESSAGES_ES : LOADING_MESSAGES_EN;

  return (
    <div className="min-h-screen pb-24 font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-display tracking-wide text-white">
            Meme<span className="text-primary">Factory</span>
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setLanguage(language === "en" ? "es" : "en")}
            className="font-bold text-lg px-2"
            data-testid="button-toggle-language"
          >
            {language === "en" ? "🇺🇸 EN" : "🇪🇸 ES"}
          </Button>
          <div className="bg-card border border-border px-3 py-1 rounded-md font-mono font-bold flex items-center gap-2">
            <span className="text-muted-foreground text-sm uppercase tracking-wider">{language === "es" ? "CRÉDITOS" : "CREDITS"}</span>
            <span className={`text-lg ${credits === 0 ? "text-destructive" : "text-primary"}`}>{credits}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8 flex flex-col items-center">
        {/* Desktop Ad Placeholder */}
        <div className="hidden md:block w-[728px] h-[90px] bg-card border border-dashed border-muted flex items-center justify-center text-muted-foreground mb-8 text-sm">
          &lt;!-- PEGA AQUÍ TU SCRIPT ADSTERRA 728x90 LEADERBOARD --&gt;
        </div>

        {/* Input Section */}
        <div className="w-full max-w-2xl mb-12">
          <form onSubmit={handleGenerate} className="flex flex-col gap-4">
            <div className="relative">
              <Play className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-6 h-6" />
              <Input 
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..." 
                className="pl-12 h-16 text-lg bg-card/50 border-primary/30 focus-visible:ring-primary text-white"
                data-testid="input-youtube-url"
              />
            </div>
            <Button 
              type="submit" 
              size="lg" 
              className="h-16 text-2xl font-display tracking-wide uppercase transition-transform active:scale-95"
              disabled={generateMutation.isPending}
              data-testid="button-generate"
            >
              {generateMutation.isPending ? (
                <span className="flex items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  {loadingMessages[loadingMsgIdx]}
                </span>
              ) : (
                <>GENERATE MEMES 🔥</>
              )}
            </Button>
          </form>
        </div>

        {/* Memes Grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <AnimatePresence>
            {memes.map((meme, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="contents"
              >
                <Card className="bg-card overflow-hidden hover:border-primary/50 transition-colors group">
                  <div className="relative">
                    <img src={meme.image_url} alt={meme.top_text} className="w-full object-cover aspect-square" />
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      <Badge variant="secondary" className="bg-black/80 backdrop-blur-sm border-none text-xs">{meme.template_name}</Badge>
                      <Badge variant="secondary" className="bg-primary/90 text-primary-foreground backdrop-blur-sm border-none text-xs w-fit font-mono">{meme.timestamp}</Badge>
                    </div>
                  </div>
                  <CardContent className="p-4 flex flex-col gap-4">
                    <p className="text-sm text-muted-foreground line-clamp-2 italic">"{meme.what_happens}"</p>
                    
                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
                      <div className="flex gap-2">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-9 w-9 bg-black hover:bg-black/80 text-white rounded-full"
                          onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(meme.top_text)}&url=${encodeURIComponent(meme.image_url)}`, '_blank')}
                          title="Share on X"
                        >
                          <TwitterIcon />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-9 w-9 bg-[#25D366] hover:bg-[#25D366]/80 text-white rounded-full"
                          onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(meme.top_text + " " + meme.image_url)}`, '_blank')}
                          title="Share on WhatsApp"
                        >
                          <WhatsAppIcon />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-9 w-9 bg-[#1877F2] hover:bg-[#1877F2]/80 text-white rounded-full"
                          onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(meme.image_url)}`, '_blank')}
                          title="Share on Facebook"
                        >
                          <FacebookIcon />
                        </Button>
                      </div>
                      
                      <Button 
                        size="icon" 
                        variant="secondary"
                        onClick={() => downloadImage(meme.image_url, `meme-${idx}.jpg`)}
                        className="h-9 w-9 hover:text-primary"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Inject Ad Placeholder every 4 cards */}
                {(idx + 1) % 4 === 0 && (
                  <Card className="bg-card border-dashed border-muted flex items-center justify-center text-muted-foreground text-sm p-4 h-[250px]">
                    &lt;!-- PEGA AQUÍ TU SCRIPT ADSTERRA 300x250 RECTANGLE --&gt;
                  </Card>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

      </main>

      {/* Mobile Ad Banner */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-[50px] bg-card border-t border-border flex items-center justify-center text-muted-foreground text-xs z-30">
        &lt;!-- PEGA AQUÍ TU SCRIPT ADSTERRA 320x50 MOBILE BANNER --&gt;
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
