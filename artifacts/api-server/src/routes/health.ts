import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  logger.info("Health check endpoint called");
  const data = HealthCheckResponse.parse({ status: "ok" });
  logger.info({ data }, "Sending health check response");
  res.status(200).json(data);
});

export default router;
