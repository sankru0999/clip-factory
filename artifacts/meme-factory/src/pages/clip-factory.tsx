import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCreateClip, useGetClipStatus, ClipCreateInputMood, ClipCreateInputMode, ClipJobStatusStatus } from "@workspace/api-client-react";
import { useCredits } from "@/hooks/use-credits";
import { useTotalUses } from "@/hooks/use-total-uses";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Settings, Upload, Link as LinkIcon, Loader2, Download } from "lucide-react";
import { AdMandatoryModal } from "@/components/AdMandatoryModal";

const POLLING_INTERVAL = 2000;

export default function ClipFactory() {
  const [inputType, setInputType] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  
  const [mode, setMode] = useState<ClipCreateInputMode>(ClipCreateInputMode.ai);
  const [startSec, setStartSec] = useState("");
  const [endSec, setEndSec] = useState("");
  const [mood, setMood] = useState<ClipCreateInputMood>(ClipCreateInputMood.energetic);

  const { credits, addCredits, deductCredit } = useCredits();
  const { incrementUses, shouldShowAd } = useTotalUses();
  const { toast } = useToast();
  
  const [showAdModal, setShowAdModal] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const createClipMutation = useCreateClip();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clipStatus = useGetClipStatus(currentJobId || "", {
    query: {
      enabled: !!currentJobId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === ClipJobStatusStatus.done || status === ClipJobStatusStatus.error) {
          return false;
        }
        return POLLING_INTERVAL;
      },
      queryKey: ["clip-status", currentJobId]
    }
  });

  const isProcessing: boolean = !!(createClipMutation.isPending || isUploading || 
    (currentJobId && clipStatus.data?.status && clipStatus.data.status !== ClipJobStatusStatus.done && clipStatus.data.status !== ClipJobStatusStatus.error));

  useEffect(() => {
    if (clipStatus.data?.status === ClipJobStatusStatus.error) {
      toast({
        title: "Error",
        description: clipStatus.data.error || "Ocurrió un error al procesar el clip.",
        variant: "destructive",
      });
      setCurrentJobId(null);
    }
  }, [clipStatus.data?.status, clipStatus.data?.error, toast]);

  const handleStartProcess = async () => {
    if (inputType === "url" && !url.trim()) {
      toast({ title: "Error", description: "Ingresa una URL válida.", variant: "destructive" });
      return;
    }
    if (inputType === "upload" && !file) {
      toast({ title: "Error", description: "Selecciona un archivo de video.", variant: "destructive" });
      return;
    }
    if (mode === "manual" && (!startSec || !endSec || Number(startSec) >= Number(endSec))) {
      toast({ title: "Error", description: "Tiempos de inicio y fin inválidos.", variant: "destructive" });
      return;
    }
    
    if (credits <= 0 && !shouldShowAd) {
      toast({ title: "Sin creditos", description: "No tienes suficientes créditos.", variant: "destructive" });
      return;
    }

    incrementUses();
    
    if (shouldShowAd) {
      setShowAdModal(true);
    } else {
      executeProcess();
    }
  };

  const handleAdClose = () => {
    setShowAdModal(false);
    addCredits(2);
    executeProcess();
  };

  const executeProcess = async () => {
    deductCredit();
    setCurrentJobId(null);
    
    if (inputType === "url") {
      createClipMutation.mutate({
        data: {
          url: url.trim(),
          mood,
          mode,
          ...(mode === "manual" ? { start: Number(startSec), end: Number(endSec) } : {})
        }
      }, {
        onSuccess: (data) => {
          setCurrentJobId(data.job_id);
        }
      });
    } else if (file) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("mood", mood);
        formData.append("mode", mode);
        if (mode === "manual") {
          formData.append("start", startSec);
          formData.append("end", endSec);
        }
        
        const res = await fetch("/api/clips/upload", {
          method: "POST",
          body: formData,
        });
        
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        setCurrentJobId(data.job_id);
      } catch (err) {
        toast({ title: "Error", description: "Fallo al subir el archivo.", variant: "destructive" });
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      const validTypes = ["video/mp4", "video/quicktime", "video/x-msvideo"];
      if (!validTypes.includes(f.type)) {
        toast({ title: "Error", description: "Formato no soportado (mp4, mov, avi).", variant: "destructive" });
        return;
      }
      setFile(f);
    }
  };

  return (
    <div className="min-h-screen pb-24 font-sans selection:bg-primary selection:text-black">
      {/* Header mock to match styles */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-7 h-7 text-primary" />
          <h1 className="text-2xl md:text-3xl font-display tracking-wide text-white">
            Clip<span className="text-primary">Factory</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-card border border-border px-3 py-1.5 rounded-md font-mono font-bold flex items-center gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              CRÉDITOS
            </span>
            <span className={`text-lg leading-none ${credits === 0 ? "text-red-500" : "text-primary"}`}>
              {credits}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-8">
        
        {/* Input Section */}
        <Card className="bg-card border-border border">
          <CardContent className="p-6">
            <Tabs value={inputType} onValueChange={(v) => setInputType(v as "url" | "upload")} className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-6 bg-zinc-900">
                <TabsTrigger value="url" className="data-[state=active]:bg-primary data-[state=active]:text-black font-bold tracking-wide" data-testid="tab-url">URL</TabsTrigger>
                <TabsTrigger value="upload" className="data-[state=active]:bg-primary data-[state=active]:text-black font-bold tracking-wide" data-testid="tab-upload">Upload</TabsTrigger>
              </TabsList>
              
              <TabsContent value="url" className="mt-0">
                <div className="relative">
                  <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5 pointer-events-none" />
                  <Input 
                    placeholder="YouTube / Twitch / Kick URL" 
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    className="pl-12 h-14 bg-black/50 border-border text-white focus-visible:ring-primary focus-visible:border-primary text-base"
                    data-testid="input-clip-url"
                    disabled={isProcessing}
                  />
                </div>
              </TabsContent>
              
              <TabsContent value="upload" className="mt-0">
                <div 
                  className={`border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-8 transition-colors ${file ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-black/50'} cursor-pointer`}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-upload"
                >
                  <input type="file" ref={fileInputRef} className="hidden" accept="video/mp4,video/quicktime,video/x-msvideo" onChange={handleFileChange} />
                  <Upload className={`w-10 h-10 mb-4 transition-colors ${file ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className="text-white font-medium mb-1">
                    {file ? file.name : "Selecciona un archivo de video"}
                  </p>
                  <p className="text-muted-foreground text-sm">MP4, MOV o AVI</p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Configuration Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-card border-border">
            <CardContent className="p-6 flex flex-col gap-4">
              <Label className="text-white/80 font-bold uppercase tracking-wider text-xs">Modo de corte</Label>
              <div className="flex bg-zinc-900 p-1 rounded-md">
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${mode === "ai" ? "bg-zinc-800 text-white shadow" : "text-muted-foreground hover:text-white"}`}
                  onClick={() => setMode(ClipCreateInputMode.ai)}
                  data-testid="btn-mode-ai"
                  disabled={isProcessing}
                >
                  AI elige el mejor momento
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${mode === "manual" ? "bg-zinc-800 text-white shadow" : "text-muted-foreground hover:text-white"}`}
                  onClick={() => setMode(ClipCreateInputMode.manual)}
                  data-testid="btn-mode-manual"
                  disabled={isProcessing}
                >
                  Yo elijo manualmente
                </button>
              </div>

              <AnimatePresence>
                {mode === "manual" && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex gap-4 overflow-hidden pt-2"
                  >
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground mb-2 block">Inicio (s)</Label>
                      <Input type="number" value={startSec} onChange={e => setStartSec(e.target.value)} className="bg-black/50 h-10 border-border" data-testid="input-start-sec" disabled={isProcessing} />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground mb-2 block">Fin (s)</Label>
                      <Input type="number" value={endSec} onChange={e => setEndSec(e.target.value)} className="bg-black/50 h-10 border-border" data-testid="input-end-sec" disabled={isProcessing} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-6 flex flex-col gap-4">
              <Label className="text-white/80 font-bold uppercase tracking-wider text-xs">Mood del Clip</Label>
              <Select value={mood} onValueChange={(v) => setMood(v as ClipCreateInputMood)} disabled={isProcessing}>
                <SelectTrigger className="w-full h-12 bg-black/50 border-border focus:ring-primary" data-testid="select-mood">
                  <SelectValue placeholder="Selecciona un mood" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="energetic">Energetico</SelectItem>
                  <SelectItem value="chill">Chill</SelectItem>
                  <SelectItem value="dramatic">Dramatico</SelectItem>
                  <SelectItem value="funny">Divertido</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleStartProcess}
          disabled={isProcessing}
          className="w-full h-16 text-2xl font-display tracking-widest uppercase bg-primary hover:bg-primary/90 text-black transition-all active:scale-[0.98]"
          data-testid="button-generate-clip"
        >
          {isProcessing ? "PROCESANDO..." : "GENERAR CLIP 🔥"}
        </Button>

        {/* Progress Section */}
        {isProcessing && (
          <Card className="bg-card border-primary/50 shadow-[0_0_15px_rgba(0,255,65,0.1)]">
            <CardContent className="p-6 flex flex-col gap-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-primary font-bold animate-pulse flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isUploading ? "Subiendo archivo..." : (clipStatus.data?.step || "Iniciando proceso...")}
                </span>
                <span className="text-white font-mono font-bold">
                  {clipStatus.data?.progress || 0}%
                </span>
              </div>
              <div className="w-full h-3 bg-zinc-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${clipStatus.data?.progress || 0}%` }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result Section */}
        {clipStatus.data?.status === ClipJobStatusStatus.done && clipStatus.data.download_url && (
          <Card className="bg-card border-primary">
            <CardContent className="p-6 flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-display text-white tracking-wide">¡Tu clip está listo!</h3>
                <a 
                  href={`/api/clips/download/${currentJobId}`}
                  download
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-black font-bold rounded-md hover:bg-primary/90 transition-colors"
                  data-testid="button-download-clip"
                >
                  <Download className="w-4 h-4" />
                  Descargar
                </a>
              </div>
              <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-border flex items-center justify-center relative shadow-lg shadow-primary/10">
                <video 
                  src={`/api/clips/download/${currentJobId}`} 
                  controls 
                  className="w-full h-full object-contain"
                  data-testid="video-result"
                />
              </div>
            </CardContent>
          </Card>
        )}

      </main>

      <AdMandatoryModal open={showAdModal} onClose={handleAdClose} />
    </div>
  );
}
