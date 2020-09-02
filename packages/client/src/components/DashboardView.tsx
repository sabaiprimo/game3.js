import React, { Component } from 'react';
import { drizzleConnect } from "@drizzle/react-plugin";
import { Flex, Flash, Box } from "rimble-ui";
import styled from "styled-components";

import { isPast } from 'date-fns';

import { getGameSession } from "../helpers/database";
import PlayerTournamentResults from "./PlayerTournamentResults";
import PlayerOngoingTournaments from "./PlayerOngoingTournaments";
// import PlayerGameReplays from "./PlayerGameReplays";

const StyledFlex = styled(Flex)`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  margin: 0;
  max-width: 1180px;

  @media screen and (min-width: 375px) {
    margin: 0 auto;
  }

  @media screen and (min-width: 640px) {
    justify-content: center;
    align-items: flex-start;
    flex-direction: row;
  }
`

class DashboardView extends Component {
  constructor(props) {
    super(props);
    this.state = {
      currentNetwork: null,
      address: null,
      tournamentsCount : 0,
      tournaments: []
    }
  }

  componentDidMount() {
    const { address, networkId, drizzleStatus, drizzle} =  this.props

    this.updateAddress(address)
    this.updateDrizzle(networkId, drizzleStatus, drizzle)
  }

  componentWillReceiveProps(newProps) {
    const { address, networkId, drizzleStatus, drizzle } = this.props
    const { address: newAddress, networkId: newNetworkId, 
      drizzleStatus: newDrizzleStatus, drizzle: newDrizzle } = newProps

    if (address !== newAddress) {
      this.updateAddress(newAddress)
    }
    if (networkId !== newNetworkId || drizzleStatus !== newDrizzleStatus
      || drizzle !== newDrizzle) {
      this.updateDrizzle(newNetworkId, newDrizzleStatus, newDrizzle)
    }
  }

  updateAddress = (address) => {
    this.setState({ address })
  }

  updateDrizzle = (networkId, drizzleStatus, drizzle) => {
    if (networkId) {
      this.setState({ currentNetwork: networkId} );
    }
    if (!drizzleStatus.initialized && window.web3 && drizzle !== null) {
      window.web3.version.getNetwork((error, networkId) => {
        this.setState({ currentNetwork: parseInt(networkId) } );
      });
    }
    if (drizzleStatus.initialized && window.web3 && drizzle !== null) {
      this.fetchPlayerTournaments();
    }
  }

  fetchPlayerTournaments = async () => {
    const { drizzle, address } = this.props;

      const contract = drizzle.contracts.Tournaments;
      const tournamentsCount = await contract.methods.getTournamentsCount().call();
  
      let tournaments = [];
  
      for (let tournamentId = 0; tournamentId < tournamentsCount; tournamentId++) {
        const tournamentDetails = await contract.methods.getTournament(tournamentId).call()
        
        const tournament = {
          id: tournamentId,
          organizer: tournamentDetails['0'],
          endTime: parseInt(tournamentDetails['1']),
          prize: tournamentDetails['2'],
          state: parseInt(tournamentDetails['3']),
          balance: tournamentDetails['4'],
          timeIsUp: false,
          canDeclareWinner: false,
          results: [],
          buyIn : 0,
          playerAddress: ''
        }
  
        tournament.timeIsUp = isPast(new Date(tournament.endTime));
  
        const resultsCount = await contract.methods.getResultsCount(tournament.id).call()
        let results = []
        for (let resultIdx = 0; resultIdx < resultsCount; resultIdx++) {
          const resultDetails = await contract.methods.getResult(tournament.id, resultIdx).call()
          const result = ({
            tournamentId: tournament.id,
            resultId: resultIdx,
            isWinner: resultDetails['0'],
            playerAddress: resultDetails['1'].toLowerCase(),
            sessionId: resultDetails['2'],
            sessionData: {}
          })
          
          this.fetchGameSession(result.sessionId, address, tournamentId)
          .then( gameSession => {
            result.sessionData = gameSession;
          });
          
          results.push(result);
        }

        let playerResults = results.filter( result => result.playerAddress === address.toLowerCase());
        tournament.results = playerResults;

        const buyIn = await contract.methods.buyIn(tournamentId, address);

        if (buyIn !== 0) {
          tournaments.push(tournament);
        }
      }

      this.setState({
        tournaments
      })
  }

  fetchGameSession = async (sessionId, playerAddress, tournamentId) => {
    const gameSession = await getGameSession(sessionId, playerAddress, tournamentId);
    return gameSession;
  }

    render() {
      const { account, accountValidated, drizzle, setRoute } = this.props;
      const { tournaments } = this.state;

      return (
        <StyledFlex>
          {account && accountValidated ? (
            <>
            <PlayerTournamentResults 
              drizzle={drizzle} 
              account={account} 
              setRoute={setRoute}
              tournaments={tournaments}
            />

            <PlayerOngoingTournaments 
              drizzle={drizzle} 
              account={account} 
              setRoute={setRoute}
              tournaments={tournaments}
            />
            </>
          ) : (
            <Flash> You have to be logged in to view. </Flash>
          )}
          {/* <PlayerGameReplays /> */}
        </StyledFlex>  
      );
      }

}
/*
 * Export connected component.
 */
const mapStateToProps = state => {
  return {
    drizzleStatus: state.drizzleStatus,
    address: state.accounts[0],
    networkId: state.web3.networkId
  };
};
  
export default drizzleConnect(DashboardView, mapStateToProps);