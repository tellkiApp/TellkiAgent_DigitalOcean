/**
 * This script was developed by Guberni and is part of Tellki's Monitoring Solution
 *
 * April, 2015
 * 
 * Version 1.0
 * 
 * DESCRIPTION: Monitor DigitalOcean droplets
 *
 * SYNTAX: node digitalocean_monitor.js <METRIC_STATE> <TOKEN> <DROPLET_FILTER>
 * 
 * EXAMPLE: node digitalocean_monitor.js "1,1" "token" "droplet-name1;droplet-name2"
 *
 * README:
 *		<METRIC_STATE> is generated internally by Tellki and it's only used by Tellki default monitors: 1 - metric is on; 0 - metric is off
 *		<TOKEN> API Token to account access
 *		<DROPLET_FILTER> List of droplets to filter results
 */

var DigitalOcean = require('do-wrapper');

/**
 * Metrics.
 */
var metrics = [];

metrics['Status'] = { id: '1696:Status:9' };
metrics['SnapshotAge']	= { id: '1697:Last Snapshot:4' };

var inputLength = 3;

/**
 * Entry point.
 */
(function() {
	try
	{
		monitorInput(process.argv);
	}
	catch(err)
	{	
		if(err instanceof InvalidParametersNumberError)
		{
			console.log(err.message);
			process.exit(err.code);
		}
		else if(err instanceof UnknownHostError)
		{
			console.log(err.message);
			process.exit(err.code);
		}
		else
		{
			console.log(err.message);
			process.exit(1);
		}
	}
}).call(this);

// ############################################################################
// PARSE INPUT

/**
 * Verify number of passed arguments into the script, process the passed arguments and send them to monitor execution.
 * Receive: arguments to be processed
 */
function monitorInput(args)
{
	args = args.slice(2);
	if(args.length != inputLength)
		throw new InvalidParametersNumberError();
	
	//<METRIC_STATE>
	var metricState = args[0].replace('"', '');
	var tokens = metricState.split(',');
	var metricsExecution = new Array();
	for(var i in tokens)
		metricsExecution[i] = (tokens[i] === '1');
	
	//<TOKEN>
	var token = args[1];
	
	//<DROPLET_LIST>
	var arg = args[2].replace(/\"/g, '');
	var dropletList = arg.length === 0 ? [] : arg.split(';');

	// Create request object to be executed.
	var request = new Object()
	request.checkMetrics = metricsExecution;
	request.token = token;
	request.dropletList = dropletList;
	
	// Get metrics.
	processRequest(request);
}

// ############################################################################
// GET METRICS

/**
 * Retrieve metrics information
 * Receive: object request containing configuration
 */
function processRequest(request) 
{
	var metricList = [];
	var api = new DigitalOcean(request.token, 1024 * 1024);
		
	api.account(function(err, response) {
		if (response.statusCode != 200)
		{
			if (response.body.id === 'unauthorized')
			{
				errorHandler(new InvalidAuthenticationError());
			}
			else
			{
				console.log(response.body.message);
				process.exit(-2);
			}
		}
		else
		{
			api.dropletsGetAll({ includeAll : true }, function(err, response) {
				var droplets = response.body.droplets;
				
				for (var i = 0; i < droplets.length; i++)
				{
					var droplet = droplets[i];
					
					if (match(droplet, request.dropletList))
					{
						// Status
						if (request.checkMetrics[0])
							metricList.push({
								id: metrics['Status'].id,
								val: droplet.status === 'active' || droplet.status === 'new' ? '1' : '0=' + droplet.status,
								obj: droplet.name
							});
						
						// Snapshot
						if (request.checkMetrics[1])
						{
							if (droplet.snapshot_ids.length === 0)
							{
								metricList.push({
									id: metrics['SnapshotAge'].id,
									val: '0',
									obj: droplet.name
								});
							}
							else
							{
								(function (d) {
									api.dropletsGetSnapshots(d.id, { includeAll : true }, function(err, response) {

										var hours = Number.MAX_VALUE;
										for (var j = 0; j < response.body.snapshots.length; j++)
										{
											var snapshot = response.body.snapshots[j];
											
											var diffMs = (new Date() - new Date(snapshot.created_at));
											var diffHrs = Math.round((diffMs % 86400000) / 3600000);
											diffHrs = diffHrs === 0 ? 1 : diffHrs;
											hours = Math.min(diffHrs, hours);
										}

										
										var m = [];
										m.push({
											id: metrics['SnapshotAge'].id,
											val: hours,
											obj: d.name
										});
										output(m);
									});
								})(droplet);
							}
						}
					}
				}
				
				output(metricList);
			});
		}
	});
}

function match(droplet, dropletMatchList)
{
	if (dropletMatchList.length === 0)
		return true;
	
	for (var i = 0; i < dropletMatchList.length; i++)
	{
		var dropletMatchEntry = dropletMatchList[i];
		
		if (isNaN(dropletMatchEntry))
		{
			// Name
			if (droplet.name.toLowerCase().indexOf(dropletMatchEntry.trim().toLowerCase()) !== -1)
				return true;
		}
		else
		{
			// ID
			if (dropletMatchEntry === droplet.id + '')
				return true;
		}
	}
	
	return false;
}

// ############################################################################
// OUTPUT METRICS

/**
 * Send metrics to console
 * Receive: metrics list to output
 */
function output(metrics)
{
	for (var i in metrics)
	{
		var out = '';
		var metric = metrics[i];
		
		out += metric.id;
		out += '|';
		out += metric.val;
		out += '|';
		out += metric.obj;
		out += '|';
		
		console.log(out);
	}
}

// ############################################################################
// ERROR HANDLER

/**
 * Used to handle errors of async functions
 * Receive: Error/Exception
 */
function errorHandler(err)
{
	if (err instanceof InvalidAuthenticationError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else if (err instanceof MetricNotFoundError)
	{
		console.log(err.message);
		process.exit(err.code);		
	}
	else
	{
		console.log(err.message);
		process.exit(1);
	}
}

// ############################################################################
// EXCEPTIONS

/**
 * Exceptions used in this script.
 */
function InvalidAuthenticationError() {
    this.name = 'InvalidAuthenticationError';
    this.message = 'Invalid authentication.';
	this.code = 2;
}
InvalidAuthenticationError.prototype = Object.create(Error.prototype);
InvalidAuthenticationError.prototype.constructor = InvalidAuthenticationError;


function InvalidParametersNumberError() {
    this.name = 'InvalidParametersNumberError';
    this.message = 'Wrong number of parameters.';
	this.code = 3;
}
InvalidParametersNumberError.prototype = Object.create(Error.prototype);
InvalidParametersNumberError.prototype.constructor = InvalidParametersNumberError;

function MetricNotFoundError() {
    this.name = 'MetricNotFoundError';
    this.message = '';
	this.code = 8;
}
MetricNotFoundError.prototype = Object.create(Error.prototype);
MetricNotFoundError.prototype.constructor = MetricNotFoundError;
