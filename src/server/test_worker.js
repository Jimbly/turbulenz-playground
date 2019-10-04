const { ChannelWorker } = require('./glov/channel_worker.js');

class TestWorker extends ChannelWorker {
  // constructor(channel_server, channel_id) {
  //   super(channel_server, channel_id);
  // }
}
TestWorker.prototype.maintain_client_list = true;
TestWorker.prototype.emit_join_leave_events = true;
TestWorker.prototype.require_login = true;
TestWorker.prototype.auto_destroy = true;
TestWorker.prototype.allow_client_broadcast = { chat: true };

export function init(channel_server) {
  channel_server.registerChannelWorker('test', TestWorker, {
    autocreate: true,
  });
}
