// Define imports
var InetAddress     = Java.type('java.net.InetAddress')
var SipFactory      = Java.type('javax.sip.SipFactory')              // Used to access the SIP API.
var SipStack        = Java.type('javax.sip.SipStack')                // The SIP stack.
var SipProvider     = Java.type('javax.sip.SipProvider')             // Used to send SIP messages.
var MessageFactory  = Java.type('javax.sip.message.MessageFactory')  // Used to create SIP message factory.
var HeaderFactory   = Java.type('javax.sip.header.HeaderFactory')    // Used to create SIP headers.
var AddressFactory  = Java.type('javax.sip.address.AddressFactory')  // Used to create SIP URIs.
var ListeningPoint  = Java.type('javax.sip.ListeningPoint')          // SIP listening IP address/port.
var Properties      = Java.type('java.util.Properties')              // Other properties.
var LogManager      = Java.type('org.apache.logging.log4j.LogManager')

load('mod/core/processor.js')
load('mod/core/registry_helper.js')
load('mod/rest/rest.js')

function Server(locationService, registrarService, accountManagerService, config, getGateways = getGatewaysFromConfig,
    getPeers = getPeersFromConfig, getDIDs = getDIDsFromConfig, getAgents = getAgentsFromConfig) {
    let LOG = LogManager.getLogger()

    // Registration with gateways expire in 5 minutes, so we will re-register in 4
    const proRegExp = 4

    this.start = function() {
        LOG.info("Starting Sip I/O on port " + config.port + " and protocol " + config.proto)

        let gateways = getGateways()
        let dids = getDIDs()
        let peers = getPeers()
        let agents = getAgents()

        let properties = new Properties()
        let sipFactory = SipFactory.getInstance()
        let contactAddress
        let contactHeader

        sipFactory.setPathName("gov.nist")
        properties.setProperty("javax.sip.STACK_NAME", "fonoster")
        properties.setProperty("javax.sip.AUTOMATIC_DIALOG_SUPPORT", "OFF")
        // Guard against denial of service attack.
        properties.setProperty("gov.nist.javax.sip.MAX_MESSAGE_SIZE", "1048576");
        // Drop the client connection after we are done with the transaction.
        properties.setProperty("gov.nist.javax.sip.CACHE_CLIENT_CONNECTIONS", "false");
        properties.setProperty("gov.nist.javax.sip.TRACE_LEVEL", config.traceLevel);

        let sipStack = sipFactory.createSipStack(properties)
        let messageFactory = sipFactory.createMessageFactory()
        let headerFactory = sipFactory.createHeaderFactory()
        let addressFactory = sipFactory.createAddressFactory()
        let listeningPoint = sipStack.createListeningPoint(config.ip, config.port, config.proto)
        let sipProvider = sipStack.createSipProvider(listeningPoint)

        // Server's contact address and header
        contactAddress = addressFactory.createAddress("sip:" + config.ip + ":" + config.port)
        contactHeader = headerFactory.createContactHeader(contactAddress)

        // This will not scale if we have a lot of DIDs
        for (var did of dids) {
            let k = "sip:" + did.e164num + "@" + config.ip + ":" + config.port

            let ca = addressFactory.createAddress(did.contact)
            let ch = headerFactory.createContactHeader(ca)
            locationService.put(k, ch.getAddress().getURI())
        }

        let processor = new Processor(sipProvider, sipStack, headerFactory, messageFactory, addressFactory, contactHeader,
            locationService, registrarService, accountManagerService, config)

        sipProvider.addSipListener(processor.listener)

        let registerUtil = new RegistryUtil(sipProvider, headerFactory, messageFactory, addressFactory, contactHeader,
            config)

        var registerTask = new java.util.TimerTask() {
            run: function() {
                let gateways = getGateways()
                for (var gateway of gateways) {
                    LOG.debug("Register in '" + gateway.metadata.name +  "' using '"  + gateway.username + "@" + gateway.host + "'")
                    if (gateway.host !== undefined) registerUtil.requestChallenge(gateway.username, gateway.host)
                    if (gateway.registries === undefined) continue

                    for (var h of gateway.registries) {
                        LOG.debug("Register in '" + gateway.metadata.name +  "' using '"  + gateway.username + "@" + h + "'")

                        registerUtil.requestChallenge(gateway.username, h)
                    }
                }
           }
        }

        new java.util.Timer().schedule(registerTask, 5000, proRegExp * 60 * 1000);

        new RestService(locationService, gateways, peers, agents, dids).start()
    }
}

function getGatewaysFromConfig() {
    return new YamlToJsonConverter().getJson('config/gateways.yml')
}

function getDIDsFromConfig() {
    return new YamlToJsonConverter().getJson('config/dids.yml')
}

function getAgentsFromConfig() {
    return new YamlToJsonConverter().getJson('config/agents.yml')
}

function getPeersFromConfig() {
    return new YamlToJsonConverter().getJson('config/peers.yml')
}

