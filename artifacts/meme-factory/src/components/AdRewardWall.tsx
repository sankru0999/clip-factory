import { useState, useEffect } from "react";
import { useClaimAdReward } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface AdRewardWallProps {
  language: "en" | "es";
  onRewardClaimed: (credits: number) => void;
}

export function AdRewardWall({ language, onRewardClaimed }: AdRewardWallProps) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const [canClaim, setCanClaim] = useState(false);
  const claimMutation = useClaimAdReward();

  useEffect(() => {
    let timer: number;
    if (countdown !== null && countdown > 0) {
      timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    } else if (countdown === 0) {
      setCanClaim(true);
    }
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const handleWatchAd = () => {
    // In a real app we'd fetch the ad URL or use an SDK.
    // Assuming ADSTERRA_AD_URL is known or we trigger a popunder:
    const adUrl = "https://example.com/adsterra"; // Dummy placeholder
    window.open(adUrl, "_blank");
    setCountdown(15);
  };

  const handleClaim = () => {
    claimMutation.mutate(undefined, {
      onSuccess: (data) => {
        onRewardClaimed(data.credits_granted || 3);
      },
      onError: () => {
        // Fallback claim if error
        onRewardClaimed(3);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <div className="bg-card border border-border p-8 rounded-xl max-w-md w-full text-center shadow-2xl shadow-primary/20">
        <h2 className="text-3xl font-display text-primary mb-4">
          {language === "es" ? "¡SIN CRÉDITOS!" : "OUT OF CREDITS!"}
        </h2>
        <p className="text-muted-foreground mb-8 text-lg">
          {language === "es" 
            ? "¡Mira un anuncio corto y obtén 3 memes más! 🎬"
            : "Watch a short ad and get 3 more memes! 🎬"}
        </p>

        {countdown === null && !canClaim && (
          <Button 
            size="lg" 
            className="w-full text-xl font-bold h-14 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleWatchAd}
            data-testid="button-watch-ad"
          >
            {language === "es" ? "Ver anuncio ▶" : "Watch ad ▶"}
          </Button>
        )}

        {countdown !== null && countdown > 0 && !canClaim && (
          <div className="py-4 text-2xl font-bold font-mono text-primary">
            {countdown}s
          </div>
        )}

        {canClaim && (
          <Button 
            size="lg" 
            className="w-full text-xl font-bold h-14 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleClaim}
            disabled={claimMutation.isPending}
            data-testid="button-claim-reward"
          >
            {claimMutation.isPending ? (
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
            ) : null}
            {language === "es" ? "¡Reclamar mis 3 memes! 🎉" : "Claim my 3 memes! 🎉"}
          </Button>
        )}
      </div>
    </div>
  );
}
