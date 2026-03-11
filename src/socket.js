let io = null;

function setIO(server) {
  io = server;
}

function getIO() {
  return io;
}

module.exports = { setIO, getIO };
