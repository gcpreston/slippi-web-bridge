# Command ideation

Ideation for production command line interface.

```bash
## Bridge commands

# Start an unnamed bridge on localhost via default port
# Directs traffic to production web server
$ swb bridge start
> Bridge started, ID: <bridge_id>

$ swb bridge stop
> Bridge <bridge_id> stopped|crashed|terminated...
> <maybe error logs>

# Specify Slippi connection location
# Takes host and port separately, as this is how the connection API does it
$ swb bridge start --slippi-host "192.168.0.4" --slippi-port 54321

# Specify a Phoenix socket to connect to, full URI for simplicity
# Would really like this to be an agnostic WS connection
# Now that I think of it, the agnostic connection could also support
# direct streaming to a browser, which would be a good abstraction
$ swb bridge start --sink "ws://localhost:4000/socket"

$ swb bridge status
> Bridge running, ID: <bridge_id>
# or
> Bridge stopped.

# Print live logs
$ swb bridge logs
> [timestamp] Connected to Slippi.
> [timestamp] Connected to Phoenix: <reply>
> [timestamp] Forwarded MESSAGE_SIZES event.
> [timestamp] Forwarded GAME_START event.
> [timestamp] Forwarded GAME_END event.

## Source/sink commands

# Test default Slippi source
$ swb source conntest
> Testing Slippi connection at <host>:<port>...
> Slippi connection test successful.
# or
> Slippi connection test unsuccessful: <error log>

# Test other Slippi source
$ swb source conntest --host "192.168.0.4" --port 54321

# Test default Phoenix sink
# TODO: Figure out how this wants to work, since right now it wants a
#   real bridge_id. Either specify a dummy one, or create a test endpoint,
#   and overall specify some kind of connection schema.
$ swb sink conntest "ws://localhost:4000/socket"
> Testing sink connection at <URI>...
> Sink connection test successful.
#
> Sink connection test unsuccessful: <error log>

$ swb source set-default --host "192.168.0.4" --port 54321
> Set default Slippi source to <host>:<port>.

$ swb sink set-default "ws://localhost:4000/socket"
> Set default Phoenix sink to <URI>.
```

---

So it seems like [pm2](https://github.com/unitech/pm2) does just about all of this out of the box. The clustering and load balancing is confusing, I'm not sure what the application is here exactly, I suppose for running multiple instances of a web server or something. Here though I just need the OS-agnostic systemd-like features.

+-----------------+                       +-----+                       +---------------+
| CLI application | -- start/stop/etc --> | PM2 | -- start/stop/etc --> | Relay process |
+-----------------+                       +-----+                       +---------------+

- these commands would translate to PM2 ones, and then return the PM2 output

+-----------------+                 +--------------------+
| CLI application | -- conntest --> | Relay library code |
+-----------------+                 +--------------------+

- these commands would be like calling the relay program directly, but through the same CLI, and with the environment (default URIs, settings, etc)
- shouldn't need to go through the relay server process; a separate node process running terminating code is sufficient, though would need to check if Slippi would respond to a second connection successfully. This is an edge case though, since you shouldn't need to conntest the same Slippi connection if one already is running successfully. Checking a separate connection should have no issue regardless.
