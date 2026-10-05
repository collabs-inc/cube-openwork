import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { allowed, createProxy } from './proxy.mjs';

test('loopback and Cube hosts accept their own origins, reject unrelated origins and hosts', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, method: 'POST', headers: { host: 'openwork-abcdefgh.cube.site', origin: 'https://openwork-abcdefgh.cube.site', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin' } };
  assert.equal(allowed(req), true);
  assert.equal(allowed({ ...req, headers: { ...req.headers, origin: 'https://other-abcdefgh.cube.site' } }), false);
  assert.equal(allowed({ ...req, headers: { host: 'malicious.example' } }), false);
  assert.equal(allowed({ ...req, socket: { remoteAddress: '192.0.2.1' } }), false);
  assert.equal(allowed({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(allowed({ ...req, method: 'GET', headers: { host: 'localhost:1234', 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' } }), true);
});

test('proxy forwards bodies, same-origin credentials, streamed responses, and upgrades', async () => {
  const upstream = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-client');
    assert.equal(req.headers['x-openwork-host-token'], 'fixture-owner');
    if (req.method === 'POST') {
      assert.equal(req.headers.host, 'openwork-abcdefgh.cube.site');
      assert.equal(req.headers.origin, `http://127.0.0.1:${upstream.address().port}`);
      req.pipe(res);
    } else {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: second\n\n'), 15);
    }
  });
  upstream.on('upgrade', (_req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const proxy = createProxy({ port: upstream.address().port, token: 'fixture-client', hostToken: 'fixture-owner' });
  proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening');
  const port = proxy.server.address().port;
  try {
    const post = await new Promise((resolve, reject) => {
      const request = http.request({ port, host: '127.0.0.1', method: 'POST', headers: { host: 'openwork-abcdefgh.cube.site', origin: 'https://openwork-abcdefgh.cube.site', 'x-forwarded-proto': 'https' } }, response => {
        let body = ''; response.on('data', data => { body += data; }); response.on('end', () => resolve(body));
      });
      request.on('error', reject); request.end('forwarded body');
    });
    assert.equal(post, 'forwarded body');
    const response = await fetch(`http://127.0.0.1:${port}/events`);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(await response.text(), 'data: first\n\ndata: second\n\n');
    const socket = net.connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write(`GET /socket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nhello`);
    let result = '';
    await new Promise((resolve, reject) => {
      socket.on('data', data => { result += data; if (result.includes('hello')) resolve(); }); socket.on('error', reject);
    });
    assert.match(result, /101 Switching Protocols/); socket.destroy();
  } finally { proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
