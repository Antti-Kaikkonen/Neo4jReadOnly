//import express = require('express');
import express from 'express';
import http from 'http';
import { RequestResponse } from 'request';
import * as rp from 'request-promise';

var separateReqPool = {maxSockets: 3};
var httpAgent = new http.Agent()
httpAgent.maxSockets = 1

const config = require('./config');

//rp.defaults({
	//forever: true, 
	//agent: httpAgent
//});

// Create Express server
const app = express();

app.enable('etag');
app.use(express.urlencoded( { extended: true } ));
app.use(express.json()); 
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});
app.options("/*", function(req, res, next){
	res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Content-Length, X-Requested-With');
  res.sendStatus(200);
});	


app.route('/db/data/read-only_query')
	.get(async (clientRequest: express.Request, clientResponse: express.Response) => {
		let query = clientRequest.query.query;
		let params = JSON.parse(clientRequest.query.params);
		await handleCypherRequest(query, params, clientResponse);
	})
	.post(async (clientRequest: express.Request, clientResponse: express.Response) => {//untested
		let query = clientRequest.body.query;
		let params = clientRequest.body.params;
		await handleCypherRequest(query, params, clientResponse);
	}
)

app.listen(config.port, config.host, () => console.log('Listening on port ', config.port));


let handleCypherRequest = async (cypherQuery: string, queryParams: object, clientResponse: express.Response) => {

	if (cypherQuery === undefined || typeof cypherQuery !== "string") {
		clientResponse.status(400).send("Cypher query missing or invalid format");
		return;
	}	
	await executeQuery(cypherQuery, queryParams || {}, (error, res, body) => {
		if (body && body.errors && body.errors.length > 0) {
			clientResponse.status(400).send(JSON.stringify(body.errors[0]));
		} else if (body && body.results && body.results.length > 0) {
			let results = { ... body.results[0] };
			let oldData = <[any]>results.data
			let newData = oldData.map(e => e.row);
			results.data = newData;
			delete results.stats;
			clientResponse.send(JSON.stringify(results));
		} else {
			clientResponse.sendStatus(500);
		}
	});
}

let executeQuery = async (statement: string, params: object, cb: (error, response, body) => void): Promise<void> => {
	await rp.post(
		config.neo4j_transaction_url,
		{ 
			json: { 
				statements: [{statement: statement, includeStats:true, parameters: params}]
			},
			agent: httpAgent,
			auth: {
        'user': config.neo4j_user,
        'pass': config.neo4j_password
			}
		}, async (error, response: RequestResponse, body) => {
			cb(error, response, body);
			if (body === undefined || typeof body.commit !== "string") return;
			let commitURL: string = body.commit;
			let contains_updates = body.results && body.results.length > 0 && body.results[0].stats.contains_updates;
			if (!contains_updates) {
				await rp.post(commitURL, { json: { statements: []} }).auth(config.neo4j_user, config.neo4j_password, false);
			} else {
				await rp.delete(commitURL).auth(config.neo4j_user, config.neo4j_password, false);;//Rollback (readonly)
			}
		}
	);
	
};

