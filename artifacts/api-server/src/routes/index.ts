import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fantasyRouter from "./fantasy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fantasyRouter);

export default router;
