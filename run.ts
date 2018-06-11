import * as http from 'http';
import * as request from 'request';
import * as url from 'url';

let config = require('./config');

let cypher_transaction_url = config.neo4j_transaction_url;

let headers = {'Content-Type': 'application/json',"Access-Control-Allow-Origin" : "*"};

let executeQuery = (statement: string, params: object, cb: (error, response, body) => void): any => {
	request.post(
		cypher_transaction_url,
		{ 
			json: { 
				statements: [{statement: statement, includeStats:true, parameters: params}]
			} 
		},(error, response, body) => {
			cb(error, response, body);
			if (typeof body.commit !== "string") return;
			let commitURL: string = body.commit;
			let contains_updates = body.results && body.results.length > 0 && body.results[0].stats.contains_updates;
			if (!contains_updates) {
				request.post(commitURL, { json: { statements: []} }).auth(config.neo4j_user, config.neo4j_password, false);
			} else {
				request.delete(commitURL).auth(config.neo4j_user, config.neo4j_password, false);;//Rollback (readonly)
			}
		}
	).auth(config.neo4j_user, config.neo4j_password, false);
};

http.createServer((request, response) => {
	try {
		let query: any = url.parse(request.url, true).query;
		let path:string = url.parse(request.url).pathname;
		let params: any = query.parameters;
		if (path.indexOf("/db/data/read-only_query") !== 0) {
			response.writeHead(404, headers);
			response.end();
			return;
		}
		if (request.method === "POST") {
			var jsonString = '';
			request.on('data', function (data) {
					jsonString += data;
			});
			request.on('end', function () {
					let obj;
					try {
						obj = JSON.parse(jsonString);
					} catch(error) {
						response.writeHead(400, headers);
						response.end();
						return;
					}
					let query = obj.query;
					let params = obj.params;
					console.log("query", query);
					console.log("params", params);
					if (typeof query === "string") {
						executeQuery(query, obj.params || {}, (error, res, body) => {
							if (body.errors && body.errors.length > 0) {
								response.writeHead(400, headers);
								response.write(JSON.stringify(body.errors[0]));
								response.end();
							} else if (body.results && body.results.length > 0) {
								let results = { ... body.results[0] };
								let oldData = <[any]>results.data
								let newData = oldData.map(e => e.row);
								results.data = newData;
								delete results.stats;
								response.writeHead(200, headers);
								response.write(JSON.stringify(results));
								response.end();
							} else {
								response.writeHead(400, headers);
								response.end();
							}
						});
					} else {
						response.writeHead(400, headers);
						response.end();
					}
					
			});
		} else if (request.method === "GET") {
			let cypherQuery = query.query;
			let param = JSON.parse(query.params);
			executeQuery(cypherQuery, param || {}, (error, res, body) => {
				if (body.errors && body.errors.length > 0) {
					response.writeHead(400, headers);
					response.write(JSON.stringify(body.errors[0]));
					response.end();
				} else if (body.results && body.results.length > 0) {
					let results = { ... body.results[0] };
					let oldData = <[any]>results.data
					let newData = oldData.map(e => e.row);
					results.data = newData;
					delete results.stats;
					response.writeHead(200, headers);
					response.write(JSON.stringify(results));
					response.end();
				} else {
					response.writeHead(400, headers);
					response.end();
				}
			});
		} else if (request.method === 'OPTIONS') {
			var options_headers = {};
			// IE8 does not allow domains to be specified, just the *
			// headers["Access-Control-Allow-Origin"] = req.headers.origin;
			options_headers["Access-Control-Allow-Origin"] = "*";
			options_headers["Access-Control-Allow-Methods"] = "POST, GET, PUT, DELETE, OPTIONS";
			options_headers["Access-Control-Allow-Credentials"] = false;
			options_headers["Access-Control-Max-Age"] = '86400'; // 24 hours
			options_headers["Access-Control-Allow-Headers"] = "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept";
			response.writeHead(200, options_headers);
			response.end();
		} else {
			response.writeHead(400, headers);
			response.end();
		}
	} catch(error) {
		response.writeHead(500, headers);
		response.end();
	}	
}).listen(config.port, config.host);
