import express = require('express');
import * as request from 'request';

const config = require('./config');

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
	.get((clientRequest: express.Request, clientResponse: express.Response) => {


		let query = clientRequest.query.query;
		let params = JSON.parse(clientRequest.query.params);
		let r: {abort: () => void} = handleCypherRequest(query, params, clientResponse);

		clientRequest.on("close", () => {
			r.abort();
		});
	})
	.post((clientRequest: express.Request, clientResponse: express.Response) => {//untested
		let query = clientRequest.body.query;
		let params = clientRequest.body.params;
		let r: {abort: () => void} = handleCypherRequest(query, params, clientResponse);

		clientRequest.on("close", () => {
			r.abort;
		});
	}
)

app.listen(config.port, config.host, () => console.log('Listening on port ', config.port));

let handleCypherRequest = (cypherQuery: string, queryParams: object, clientResponse: express.Response): {abort: () => void} => {
	if (cypherQuery === undefined || typeof cypherQuery !== "string") {
		clientResponse.status(400).send("Cypher query missing or invalid format");
		return;
	}	

	return executeQuery2(cypherQuery, queryParams || {}, (error, res, body) => {
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

let executeQuery2 = (statement: string, params: object, cb: (error, response, body) => void): {abort: () => void} => {
	let innerRequest: request.Request = undefined;
	let transactionURL: string;
	let outerRequest: request.Request = request.post(
		config.neo4j_transaction_url,
		{ 
			json: { 
				statements: []
			} 
		},(error, response, body) => {
			if (body === undefined || typeof body.commit !== "string") return;
			let commitURL: string = body.commit;
			transactionURL = commitURL.substr(0, commitURL.length-"/commit".length);

			innerRequest = request.post(transactionURL, { 
					json: { 
						statements: [{statement: statement, includeStats:true, parameters: params}]
					} 
				}, (error, response, body) => {
					cb(error, response, body);
					if (error) {
						return;
					}
					let contains_updates;
					try {
						contains_updates = body && body.results && body.results.length > 0 && body.results[0].stats && body.results[0].stats.contains_updates;
					} catch (e) {
						contains_updates = false;
					}
					if (!contains_updates) {
						request.post(commitURL, { json: { statements: []} }).auth(config.neo4j_user, config.neo4j_password, false);
					} else {
						request.delete(transactionURL).auth(config.neo4j_user, config.neo4j_password, false);//Rollback (readonly)
					}
				}
			).auth(config.neo4j_user, config.neo4j_password, false);
		}
	).auth(config.neo4j_user, config.neo4j_password, false);
	let abortable = { 
		abort: () => {
			if (innerRequest !== undefined) {
				innerRequest.abort();
				request.delete(transactionURL).auth(config.neo4j_user, config.neo4j_password, false);//Terminate query
			} else {
				outerRequest.abort();
			}
			
		}
	};
	return abortable;
};

