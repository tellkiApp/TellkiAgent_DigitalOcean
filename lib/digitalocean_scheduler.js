/**
 * This script was developed by Guberni and is part of Tellki's Monitoring Solution
 *
 * April, 2015
 * 
 * Version 1.0
 * 
 * DESCRIPTION: Scheduler for snapshot creation at DigitalOcean
 *
 * SYNTAX: node digitalocean_scheduler.js <TOKEN> <DROPLET_FILTER>
 * 
 * EXAMPLE: node digitalocean_scheduler.js "token" "droplet-name1;droplet-name2"
 *
 * README:
 *		<TOKEN> API Token to account access
 *		<DROPLET_FILTER> List of droplets to filter actions
 */

var DigitalOcean = require('do-wrapper');

var InputLength = 2;
var CountDropletsToProcess = 0;
var CountDropletsProcessed = 0;
var ErrorCount = 0;
var ErrorMessages = [];
 
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
		if (err instanceof InvalidParametersNumberError)
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
	if(args.length != InputLength)
		throw new InvalidParametersNumberError();
	
	//<TOKEN>
	var token = args[0];
	
	//<DROPLET_LIST>
	var arg = args[1].replace(/\"/g, '');
	var dropletList = arg.length === 0 ? [] : arg.split(';');

	// Create request object to be executed.
	var request = new Object()
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
				var dropletsToProcess = [];
				
				for (var i = 0; i < droplets.length; i++)
				{
					var droplet = droplets[i];
					
					if (match(droplet, request.dropletList))
						dropletsToProcess.push(droplet);
				}
				
				CountDropletsToProcess = dropletsToProcess.length;
				
				for (var i = 0; i < dropletsToProcess.length; i++)
				{
					var droplet = dropletsToProcess[i];
					
					// Power off and wait.
					(function (d) {
						api.dropletsRequestAction(d.id, { 'type': 'shutdown', },
							function (err, response) {
																
								if (err)
								{
									done(droplet, true, 'Error powering off droplet ' + d.name);
								}
								else if ((response.statusCode + '').indexOf('4') === 0)
								{
									done(droplet, true, 'Error powering off droplet ' + d.name);
								}
								else
								{
									if (response.body.id === 'unprocessable_entity' && response.body.message === 'Droplet is already powered off.')
										createSnapshot(api, d);
									else
										waitForPowerOffResponse(api, d);
								}
							});
					})(droplet);
				}
			});
		}
	});
}

function waitForPowerOffResponse(api, droplet)
{
	var count = 0;
	var reference = setInterval(function() {

		api.dropletsGetById(droplet.id,
			function(err, response)
			{
				if (!err && response.body.droplet.status === 'off')
				{
					clearInterval(reference);
					createSnapshot(api, droplet); // Droplet is off, create snapshot.
					return;
				}
				
				count++;
				if (count >= 12) // 2 min
					done(droplet, true, 'Error waiting for droplet power off: ' + droplet.name);
			});
	}, 10000);
}

function createSnapshot(api, droplet)
{	
	api.dropletsRequestAction(droplet.id,
		{
			'type': 'snapshot',
			'name': droplet.name + '_snapshot'
		},
		function (err, response) {			
			if (err)
			{
				done(droplet, true, 'Error requesting droplet snapshot: ' + droplet.name);
			}
			else if ((response.statusCode + '').indexOf('4') === 0)
			{
				done(droplet, true, 'Error requesting droplet snapshot: ' + droplet.name);
			}
			else
			{
				waitForSnapshotResponse(api, droplet, response.body.action.id);
			}
		});
}

function waitForSnapshotResponse(api, droplet, actionId)
{
	var count = 0;
	var reference = setInterval(function() {

		api.dropletsGetAction (droplet.id, actionId,
			function(err, response)
			{
				if (response.body.action.status === 'completed')
				{
					clearInterval(reference);
					done(droplet, false);
					return;
				}
				else if (response.body.action.status === 'errored')
				{
					clearInterval(reference);
					done(droplet, true, 'Error creating snapshot for droplet ' + droplet.name);
					return;
				}

				count++;
				if (count >= 30) // 5 min
					done(droplet, true, 'Error waiting for droplet snapshot: ' + droplet.name);
			});
	}, 10000);
}

function done(droplet, error, errorMessage)
{
	if (error)
	{
		ErrorCount++;
		ErrorMessages.push(errorMessage);
	}
	
	CountDropletsProcessed++;
	
	if (CountDropletsProcessed === CountDropletsToProcess)
	{		
		if (ErrorCount > 0)
		{
			// Error
			var message = '';
			for (var i = 0; i < ErrorMessages.length; i++)
			{
				message += ErrorMessages[i] + '\n';
				if (message.length > 200)
					break;
			}
			
			console.log(message.trim());
			process.exit(1);
		}
		else
		{
			// Success
			process.exit(0);
		}
	}
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
// ERROR HANDLER

/**
 * Used to handle errors of async functions
 * Receive: Error/Exception
 */
function errorHandler(err)
{
	if(err instanceof InvalidAuthenticationError)
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
