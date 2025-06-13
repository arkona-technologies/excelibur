# CSV Configurator

Configures Processing Chains, Transmitters and Receivers based on .csv files.

## Usage

There are 2 ways to use this right now.

### CLI 

using it via cli like so `npx tsc && URL=ws://172.16.163.2 PROC=./test/cb-with-splitter.csv TX=./test/tx.csv RX=./test/rx.csv node build/main.js`

### With .xlsx file
using it via cli like so `npx tsc && URL=ws://172.16.163.2 SHEET=/path/to/config.xlsx  node build/main.js`

### Web UI

Using the minimal web-ui/webserver found under `src/server.ts` that uses the html/css from `./web`. 
Use the build script via `npm run vscriptd` to build a vscriptd uploadable version. 
Make sure the default Port (4242) is configured for forwarding (modify `/config/forward_tcp_port_list`)


## Schemas

see `src/zod_types.ts` for definitions

### Processors

Processor use the following schema denoted by the first line of the csv:

`source_id,source_type,name,lut_name,delay_frames,video_format,splitter_phase,output_id,output_type,flow_type`

sources and sinks are identified via their type and source_id/output_id.

I.e.: source_id = 0 and source_type = 'IP-VIDEO' would be rtp-video-receiver #0

flow_type defaults to Video if left unspecified

### Receivers

Receivers use the following schema denoted by the first line of the csv:

`id,label,stream_type,sync,uhd,channel_capacity,switch_type`

id refers to the row number of the respective receiver!


### Transmitters

Transmitters use the following schema denoted by the first line of the csv:

`id,label,name,stream_type,primary_destination_address,primary_destination_port,secondary_destination_address,secondary_destination_port,payload_type`

id refers to the row number of the respective transmitter!

