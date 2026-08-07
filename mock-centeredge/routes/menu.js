// GET /api/v1/menu — the F&B menu the ordering UI renders: categories,
// items, prices (integer cents), and modifier groups (toppings, sizes, ...).
import { Router } from "express";

export function menuRouter(store) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ ok: true, menu: store.menu });
  });

  return router;
}
