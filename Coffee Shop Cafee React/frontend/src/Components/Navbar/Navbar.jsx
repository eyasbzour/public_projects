import React,{ Component } from "react";
import Logo from "../../assets/website/coffee_logo.png";
import { FaCoffee } from "react-icons/fa";

const Menus =[
    {
        id:1,
        name:"Home",
        link:'/#'
    },
    {
        id:2,
        name:"About",
        link:'#about'
     },

    {
        id:3,
        name:"Services",
        link:'#services'
    }
];

class Navbar extends Component{
    render(){
        return (
            <nav className="bg-gradient-to-r from-secondary to-secondary/90 text-white">
            <div className="container py-2">
                <div className="flex justify-between items-center gap-4">
                    {/*logo section*/}
                    <div className="logo"data-aos='fade-down' data-aos-once='true'>
                        <a href="#" className="flex flex-row justify-center items-center gap-2 tracking-wider font-cursive font-bold text-2xl sm:text-3l">
                            <img src={Logo} alt="logo"
                            className="w-14"
                            />
                            Coffee Cafe
                        </a>
                    </div>
                    {/*links section*/}
                    <div 
                    data-aos='fade-down' data-aos-once='true' data-aos-delay='300'
                    className="links flex justify-between items-center gap-4">
                        <ul className="hidden sm:flex items-center gap-4">
                            {
                                Menus.map((menuItem,index)=>{
                                    return(
                                        <li key={index}>
                                            <a 
                                                href={menuItem.link}
                                                className="inline-block
                                                text-xl py-4 px-4
                                                text-white/70
                                                hover:underline
                                                hover:text-white
                                                transition duration-300 ease-in-out">
                                                {menuItem.name}
                                            </a>
                                        </li>
                                    )
                                })
                            }
                        </ul>
                        <button className="flex gap-1 items-center justify-center btn btn-primary bg-primary/70 py-2 px-4 rounded-full hover:scale-105 duration-200 ease-in-out hover:font-bold">
                            Order
                            <FaCoffee className="text-xl cursor-pointer"/>
                        </button>
                    </div>

                </div>
            </div>
            </nav>
            );
            }
}
export default Navbar;