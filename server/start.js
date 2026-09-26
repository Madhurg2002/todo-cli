import app from './index.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  // Report the actually-bound port (PORT=0 lets the OS choose one).
  const bound = typeof server.address() === 'object' ? server.address().port : PORT;
  console.log(`todo API listening on http://${HOST}:${bound}`);
});
