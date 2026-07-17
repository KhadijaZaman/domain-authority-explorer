import { Router, type IRouter } from "express";
import healthRouter from "./health";
import domainsRouter from "./domains";
import insightsRouter from "./insights";
import corpusRouter from "./corpus";

const router: IRouter = Router();

router.use(healthRouter);
router.use(domainsRouter);
router.use(insightsRouter);
router.use(corpusRouter);

export default router;
