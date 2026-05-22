import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface AdMandatoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function AdMandatoryModal({ open, onClose }: AdMandatoryModalProps) {
  const [countdown, setCountdown] = useState(5);
  const [showReward, setShowReward] = useState(false);

  useEffect(() => {
    if (open) {
      setCountdown(5);
      setShowReward(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open, countdown]);

  const handleClose = () => {
    setShowReward(true);
    setTimeout(() => {
      onClose();
    }, 1500); // Wait for animation to finish
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md p-6 rounded-lg border border-border shadow-lg relative overflow-hidden flex flex-col items-center">
        <h2 className="text-2xl font-display text-white mb-2 tracking-wide">Anuncio obligatorio</h2>
        <div className="absolute top-4 right-4 text-primary font-mono text-xl font-bold">
          {countdown > 0 ? countdown : "0"}
        </div>
        <p className="text-muted-foreground text-center mb-6">
          Recibiras 2 creditos al terminar
        </p>
        
        <div className="w-full h-[250px] bg-muted/30 border border-dashed border-muted-foreground/30 flex items-center justify-center rounded-md mb-6 relative">
          <span className="text-muted-foreground text-sm">Ad Placeholder</span>
          <AnimatePresence>
            {showReward && (
              <motion.div 
                initial={{ opacity: 0, y: 0, scale: 0.8 }}
                animate={{ opacity: 1, y: -50, scale: 1.2 }}
                exit={{ opacity: 0 }}
                className="absolute text-primary font-display text-3xl drop-shadow-md z-10 tracking-wider"
              >
                +2 creditos
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Button
          onClick={handleClose}
          disabled={countdown > 0 || showReward}
          className={`w-full h-12 text-lg font-display tracking-widest transition-all ${
            countdown > 0 
              ? "bg-zinc-800 text-zinc-500 hover:bg-zinc-800" 
              : "bg-primary text-black hover:bg-primary/90 hover:scale-[1.02]"
          }`}
          data-testid="button-close-ad"
        >
          {showReward ? "RECOMPENSA OBTENIDA" : "CERRAR"}
        </Button>
      </div>
    </div>
  );
}
