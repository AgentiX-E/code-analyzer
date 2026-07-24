import express from 'express';

const router = express.Router();

router.get('/users', (req, res) => {
  res.json({ users: [] });
});

router.post('/users', (req, res) => {
  const { name } = req.body;
  res.status(201).json({ name });
});

router.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});

router.put('/users/:id', (req, res) => {
  res.json({ id: req.params.id, ...req.body });
});

router.delete('/users/:id', (req, res) => {
  res.status(204).send();
});

export default router;
